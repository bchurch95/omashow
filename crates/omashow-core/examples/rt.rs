fn main() {
    let a: Vec<String> = std::env::args().collect();
    let pres = omashow_core::open_pptx_full(&a[1]).unwrap();
    omashow_core::save_presentation(&a[2], &pres).unwrap();
    println!("roundtripped");
}
