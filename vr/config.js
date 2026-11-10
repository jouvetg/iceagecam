// Swiss Time Machine VR (Meta Quest): data on Zenodo, VR / mixed-reality buttons enabled.
window.ALPS3D_CONFIG = {
  data: "https://zenodo.org/api/records/24003777/files/{name}/content",
  vr: true,
  // extra landmarks in VR, [name, u, v] (u west->east, v north->south, as meta.cities)
  towns: [["Sion", 0.3463, 0.7722], ["Lugano", 0.6588, 0.8787], ["Chur", 0.7718, 0.5039], ["Neuchâtel", 0.2672, 0.4347],
    ["Fribourg", 0.3111, 0.5175], ["St. Gallen", 0.7409, 0.2507], ["Interlaken", 0.4469, 0.5746], ["Montreux", 0.2594, 0.6814],
    ["Martigny", 0.2888, 0.8277], ["Brig", 0.4699, 0.7388], ["Thun", 0.4014, 0.5418], ["Biel/Bienne", 0.3296, 0.3721],
    ["Bellinzona", 0.6729, 0.7940], ["Zermatt", 0.4217, 0.8682], ["St. Moritz", 0.8319, 0.6621], ["Andermatt", 0.5892, 0.5992],
    ["Winterthur", 0.6154, 0.2180], ["Schaffhausen", 0.5986, 0.1301], ["Annecy", 0.1010, 0.9089], ["Chamonix", 0.2474, 0.9053],
    ["Aosta", 0.3354, 0.9911], ["Como", 0.6853, 0.9651], ["Konstanz", 0.7021, 0.1467]],
  peaks: [["Mont Blanc", 0.2459, 0.9455], ["Matterhorn", 0.4036, 0.8873], ["Dufourspitze", 0.4446, 0.9057],
    ["Jungfrau", 0.4657, 0.6411], ["Finsteraarhorn", 0.4977, 0.6415], ["Piz Bernina", 0.8464, 0.7097], ["Säntis", 0.7347, 0.3281],
    ["Titlis", 0.5589, 0.5386], ["Grand Combin", 0.3324, 0.9023], ["Tödi", 0.6519, 0.5220]],
  home: "../",
  logos: [
    { src: "../logo_unil_orange.svg", href: "https://www.unil.ch", alt: "Université de Lausanne" },
    { src: "../Iceagecam_Logo_2.png", href: "https://iceagecam.ch", alt: "IceAgeCam" },
  ],
};
