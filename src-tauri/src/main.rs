// Empeche une fenetre console supplementaire sous Windows en release, NE PAS SUPPRIMER.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    techno_tagger_lib::run();
}
