// Location of the viewer data on Zenodo ("{name}" is replaced by each file name).
// The /api/records/<id>/files/<name>/content form is required: it allows the files to be read from this website.
window.ALPS3D_CONFIG = {
  data: "https://zenodo.org/api/records/24003777/files/{name}/content",
  home: "../",                          // target of the "More info" button
  logos: [                              // logos shown next to it
    { src: "../logo_unil_orange.svg", href: "https://www.unil.ch", alt: "Université de Lausanne" },
    { src: "../logo_uzh_orange.svg", href: "https://www.uzh.ch", alt: "Universität Zürich" },
    { src: "../Iceagecam_Logo_2.png", href: "https://iceagecam.ch", alt: "IceAgeCam" },
  ],
};
