# Linux AppImage Crash Debugging & Investigation Report

## Incident Summary
- **Process**: `omashow-tauri` (PID: 1205794)
- **Signal**: `SIGABRT` (signal 6)
- **Binary**: `/tmp/.mount_OmashocPKGoE/usr/bin/omashow-tauri` (extracted from `Omashow_0.1.2_amd64.AppImage`)
- **OS Tested On**: Omarchy / Arch Linux (Kernel 6.13+, Intel Core Ultra Arc iGPU with `xe` kernel driver, Hyprland Wayland compositor)
- **Failure Point**: Early startup during Tauri webview / WebKitGTK WebContext initialization (`tauri::app::setup` -> `tauri_runtime_wry::create_webview`).

---

## Technical Backtrace

Extracted from systemd-coredump:

```text
#0  0x000078e9b749a17c in ?? () from /usr/lib/libc.so.6
#1  0x000078e9b743e5d0 in raise () from /usr/lib/libc.so.6
#2  0x000078e9b7425685 in abort () from /usr/lib/libc.so.6
#3  0x000078e9bd5c066e in ?? () from /tmp/.mount_OmashocPKGoE/usr/lib/libwebkit2gtk-4.1.so.0
#4  0x000078e9bb4b8561 in ?? () from /tmp/.mount_OmashocPKGoE/usr/lib/libwebkit2gtk-4.1.so.0
#5  0x000078e9b749d7fc in ?? () from /usr/lib/libc.so.6
#6  0x000078e9b749d879 in pthread_once () from /usr/lib/libc.so.6
#7  0x000078e9bb4b4b53 in ?? () from /tmp/.mount_OmashocPKGoE/usr/lib/libwebkit2gtk-4.1.so.0
...
#18 0x000078e9bff2c1df in ?? () from /tmp/.mount_OmashocPKGoE/usr/lib/libgobject-2.0.so.0
#19 0x000078e9bff2d407 in g_object_new_with_properties () from /tmp/.mount_OmashocPKGoE/usr/lib/libgobject-2.0.so.0
#20 0x000064383056e91d in <glib::object::Object>::new_internal ()
#21 0x0000643830568626 in <webkit2gtk::auto::web_context::WebContextBuilder>::build ()
#22 0x00006438304f69a2 in <wry::webkitgtk::web_context::WebContextImpl>::new ()
#23 0x00006438304f9132 in <wry::web_context::WebContext>::new ()
#24 0x0000643830054487 in tauri_runtime_wry::create_webview::<tauri::EventLoopMessage> ()
#25 0x00006438300537ee in tauri_runtime_wry::create_window::<tauri::EventLoopMessage, ...> ()
#31 0x0000643830174823 in tauri::app::setup::<tauri_runtime_wry::Wry<tauri::EventLoopMessage>> ()
#37 0x0000643830047de6 in omashow_tauri::main ()
```

---

## Disassembly and Abort Message Analysis

Inspection of WebKitGTK frame 3 in GDB revealed:

```asm
0x78e9bd5c0658: lea    0x1293869(%rip),%rdi        # "Could not create surfaceless EGL display: %s. Aborting..."
0x78e9bd5c065f: mov    %rax,%rsi                   # Error description returned by eglGetError()
0x78e9bd5c0662: xor    %eax,%eax
0x78e9bd5c0664: call   <WTFLogAlways@plt>
0x78e9bd5c0669: call   <abort@plt>
```

WebKitGTK called `eglGetPlatformDisplayEXT(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, nullptr)`.
The call failed and returned `EGL_NO_DISPLAY` with error `0x3003` (`EGL_BAD_ALLOC`), prompting WebKitGTK to abort immediately.

---

## Root Cause: Library Shadowing in AppImage

1. **Build Environment**: The Linux AppImage was built on GitHub Actions runner `ubuntu-22.04` using `cargo tauri build --bundles appimage`.
2. **Bundled Libraries**: Tauri / `linuxdeploy` bundled `libwayland-client.so.0` from Ubuntu 22.04 (Wayland 1.20) into the AppImage's `usr/lib/`.
3. **Runtime `LD_LIBRARY_PATH`**: `AppRun` in the AppImage prepends `$APPDIR/usr/lib` to `LD_LIBRARY_PATH`.
4. **Host Driver Resolution**:
   - On the host (Arch Linux), WebKitGTK loads libglvnd (`libEGL.so.1`), which searches for an EGL provider.
   - libglvnd attempts to load `/usr/lib/libEGL_mesa.so.0`.
   - The host's `libEGL_mesa.so.0` was compiled against modern Wayland and depends on the symbol `wl_fixes_interface`.
   - Because `LD_LIBRARY_PATH` prioritizes the AppImage's bundled `usr/lib`, dynamic linking resolves `libwayland-client.so.0` to the bundled Ubuntu 22.04 version instead of the host version.
   - Ubuntu 22.04's `libwayland-client.so.0` does **not** export `wl_fixes_interface`.
   - Result: `dlopen("/usr/lib/libEGL_mesa.so.0")` fails:
     ```
     /usr/lib/libEGL_mesa.so.0: undefined symbol: wl_fixes_interface
     ```
   - With Mesa EGL unavailable, surfaceless display initialization fails and WebKitGTK aborts.

### Verification Proof
Running a dynamic loader test with Python:
- `LD_LIBRARY_PATH=/tmp/squashfs-root/usr/lib python3 -c "ctypes.CDLL('libEGL_mesa.so.0')"`:
  `FAILED: /usr/lib/libEGL_mesa.so.0: undefined symbol: wl_fixes_interface`
- `LD_PRELOAD=/usr/lib/libwayland-client.so.0 LD_LIBRARY_PATH=/tmp/squashfs-root/usr/lib ...`:
  `SUCCESS loading libEGL_mesa.so.0 with host libwayland-client preloaded!`
  Surfaceless EGL display initialization returns success (`error: 0x3000`).

---

## Workarounds

### 1. Host Runtime Workarounds
If running the existing `Omashow_0.1.2_amd64.AppImage` on modern Arch/Omarchy/Fedora:

```bash
# Force host Wayland library resolution:
LD_PRELOAD=/usr/lib/libwayland-client.so.0 ./Omashow_0.1.2_amd64.AppImage

# Or disable WebKit's hardware-accelerated DMA-BUF renderer:
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./Omashow_0.1.2_amd64.AppImage
```

---

## Permanent CI / Packaging Fixes

In the repository release pipeline (`.github/workflows/release.yml`):

1. **Upgrade GitHub Actions Runner**:
   Change `runs-on: ubuntu-22.04` to `runs-on: ubuntu-24.04`. Ubuntu 24.04 ships with Wayland >= 1.22/1.23, which includes `wl_fixes_interface` and modern EGL platform symbols.

2. **Expose Host Graphics / Wayland Libraries (Excludelist)**:
   In Tauri's AppImage / linuxdeploy bundling configuration, do not bundle `libwayland-client.so.0`, `libwayland-egl.so.1`, `libgbm.so.1`, or `libdrm.so.2`. These client libraries are intended to be provided by the host graphics environment matching the host Mesa/GPU drivers.
   - Alternatively, use `linuxdeploy` with `--custom-apprun` or an apprun hook that removes `libwayland-client.so*` from the search path if host version is newer.
