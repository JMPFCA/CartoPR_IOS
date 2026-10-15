if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

let searchTimer;
let searchMarker;
let selectedPlace = null;


let gvoDisponiblesGlobal = [];

let prMarkers = [];
let leafletMap;
let routeLine;
let markerStart;
let markerEnd;
let MarkRond;

let clicMarkers = []; // Stocke les bornes oranges générées par le clic sur la carte
let contourParcelleSelectionnee = null; // Stocke la parcelle violette active

let coucheQualicharge = L.layerGroup();
let baseQualichargeTraitee = null; // Contiendra le tableau d'objets nettoyés




let coucheEchangeurs = L.layerGroup();
// --- CONTENEURS ET VARIABLES DE SUIVI DES POINTS EXACTS ---
let containerPointsTous = L.layerGroup();
let containerPointsBlancs = L.layerGroup();
let containerPointsRouges = L.layerGroup();

// Variables de gestion de l'état masqué/affiché des bornes
let bornesBlanchesMasquees = false;
let bornesOrangesMasquees = false;

let MarkRougeMasque = false ;
let MarkVertMasque = false ;
let MarkBleuMasque = false ;


let coucheRRN_C = L.layerGroup();
let coucheRRN_NC = L.layerGroup();

let blueMarkers = [];
// Variable globale pour gérer le facteur d'échelle des icônes
let facteurZoomIcones = 1.0;

window.calculCarrefoursEnCours = false;

// Variable globale pour numéroter les événements du rapport en cours
let rapportIndexEvent = 0;


let optionsGeoJSONRRN = {
    coordsToLatLng: function(coords) {
        let lat, lon;
        if (Math.abs(coords[0]) > 180) {
            const conversion = lambert93ToWGS84_RRN(coords[0], coords[1]);
            lat = conversion.lat;
            lon = conversion.lon;
        } else {
            lat = coords[1];
            lon = coords[0];
        }
        return L.latLng(lat, lon);
    },
    onEachFeature: configurerPopupRRN
};


/* ---------------- CALCUL DE LA LONGUEUR DU RÉSEAU AFFICHÉ ---------------- */

function mettreAJourLongueurReseauAffiche() {
    let longueurTotaleMetres = 0;

    // Fonction interne pour sommer les géométries d'une couche Leaflet active
    function sommerCouche(layerGroup) {
        if (!map.hasLayer(layerGroup)) return;
        
        layerGroup.eachLayer(layer => {
            // Si c'est un GeoJSON contenant des polylignes
            if (typeof layer.eachLayer === 'function') {
                layer.eachLayer(sousCouche => {
                    longueurTotaleMetres += calculerLongueurSegmentLeaflet(sousCouche);
                });
            } else {
                longueurTotaleMetres += calculerLongueurSegmentLeaflet(layer);
            }
        });
    }

    function calculerLongueurSegmentLeaflet(layer) {
        let dist = 0;
        if (layer instanceof L.Polyline && typeof layer.getLatLngs === 'function') {
            const latlngs = layer.getLatLngs();
            // Gestion des polylignes simples ou multi-segments
            const aplatirLatLngs = (coords) => {
                let dAccumulee = 0;
                for (let i = 0; i < coords.length - 1; i++) {
                    if (coords[i] instanceof L.LatLng && coords[i+1] instanceof L.LatLng) {
                        dAccumulee += coords[i].distanceTo(coords[i+1]);
                    } else if (Array.isArray(coords[i])) {
                        dAccumulee += aplatirLatLngs(coords[i]);
                    }
                }
                return dAccumulee;
            };
            dist = aplatirLatLngs(latlngs);
        } else if (layer.feature && layer.feature.properties) {
            // Si la propriété 'long_km' est directement présente dans les données GESIR
            const props = layer.feature.properties;
            const kmProp = props['long_km'] !== undefined ? parseFloat(props['long_km']) : 
                           (props['LONG_KM'] !== undefined ? parseFloat(props['LONG_KM']) : NaN);
            if (!isNaN(kmProp)) {
                return kmProp * 1000; // Conversion en mètres
            }
        }
        return dist;
    }

    // 1. Vérification des couches RRN
    sommerCouche(coucheRRN_C);
    sommerCouche(coucheRRN_NC);

    // 2. Vérification des couches GESIR
    sommerCouche(coucheGESIR_C);
    sommerCouche(coucheGESIR_NC);

    // Affichage formaté dans le bloc HTML
    const spanInfo = document.getElementById('infoLongueurReseau');
    if (spanInfo) {
        const km = (longueurTotaleMetres / 1000).toFixed(1).replace(/\B(?=(\d{3})+(?!\d))/g, " ");;
        spanInfo.textContent = `${km} km`;
    }
}

//GESIR
const btnGESIR_C = document.getElementById('btnToggleGESIR_C');
const btnGESIR_NC = document.getElementById('btnToggleGESIR_NC');
const subOptsC = document.getElementById('subOptions_GESIR_C');
const subOptsNC = document.getElementById('subOptions_GESIR_NC');

// États de masquage par classification
let donneesBrutesGESIR_C = null;
let donneesBrutesGESIR_NC = null;

let coucheGESIR_C = L.layerGroup();
let coucheGESIR_NC = L.layerGroup();

const gesirC_classesMasquees = new Set();
const gesirNC_classesMasquees = new Set();

// Fonction de style dynamique prenant en compte les filtres masqués
function creerCoucheGESIRFiltree(donneesTopo, objetNom, classesMasquees) {
    const geojsonConverti = topojson.feature(donneesTopo, donneesTopo.objects[objetNom] || Object.keys(donneesTopo.objects)[0]);
    
    return L.geoJSON(geojsonConverti, {
        coordsToLatLng: function(coords) {
            let lat, lon;
            if (Math.abs(coords[0]) > 180) {
                const conversion = lambert93ToWGS84_RRN(coords[0], coords[1]);
                lat = conversion.lat;
                lon = conversion.lon;
            } else {
                lat = coords[1];
                lon = coords[0];
            }
            return L.latLng(lat, lon);
        },
        filter: function(feature) {
            // Filtre gestionnaire + Filtre classes masquées
            if (!featurePasseFiltreGestionnaire(feature)) return false;

            const props = feature.properties || {};
            const val = String(props['Classifica'] !== undefined ? props['Classifica'] : (props['classifica'] !== undefined ? props['classifica'] : 'ND')).trim();
            const cleClass = (val === "" || val === "0" || val === "null" || val === "undefined") ? "ND" : val;
            
            return !classesMasquees.has(cleClass);
        },
        style: styleArcGESIR,
        onEachFeature: configurerPopupGESIR
    });
}

function rafraichirToutesLesCouchesRoutieres() {
    // Mémoriser si les couches RRN étaient affichées avant le rafraîchissement
    const etaitAfficheRRN_C = typeof coucheRRN_C !== 'undefined' && map.hasLayer(coucheRRN_C);
    const etaitAfficheRRN_NC = typeof coucheRRN_NC !== 'undefined' && map.hasLayer(coucheRRN_NC);

    // 1. RRN C
    if (typeof coucheRRN_C !== 'undefined') {
        if (map.hasLayer(coucheRRN_C)) map.removeLayer(coucheRRN_C);
        coucheRRN_C.clearLayers();
        if (typeof donneesRRN_C !== 'undefined') {
            const geojsonConverti = topojson.feature(donneesRRN_C, donneesRRN_C.objects.RRN_C);
            L.geoJSON(geojsonConverti, {
                coordsToLatLng: optionsGeoJSONRRN.coordsToLatLng,
                onEachFeature: configurerPopupRRN,
                filter: featurePasseFiltreGestionnaire,
                style: { color: "blue", weight: 3 }
            }).addTo(coucheRRN_C);
            
            // Restaure l'état d'affichage réel (ne s'affiche que si elle était visible)
            if (etaitAfficheRRN_C) coucheRRN_C.addTo(map);
        }
    }

    // 2. RRN NC
    if (typeof coucheRRN_NC !== 'undefined') {
        if (map.hasLayer(coucheRRN_NC)) map.removeLayer(coucheRRN_NC);
        coucheRRN_NC.clearLayers();
        if (typeof donneesRRN_NC !== 'undefined') {
            const geojsonConverti = topojson.feature(donneesRRN_NC, donneesRRN_NC.objects.RRN_NC);
            L.geoJSON(geojsonConverti, {
                coordsToLatLng: optionsGeoJSONRRN.coordsToLatLng,
                onEachFeature: configurerPopupRRN,
                filter: featurePasseFiltreGestionnaire,
                style: { color: "green", weight: 3 }
            }).addTo(coucheRRN_NC);
            
            // Restaure l'état d'affichage réel
            if (etaitAfficheRRN_NC) coucheRRN_NC.addTo(map);
        }
    }

    // 3. GESIR C (si affichée)
    if (typeof coucheGESIR_C !== 'undefined' && map.hasLayer(coucheGESIR_C)) {
        rafraichirCoucheGESIR('C');
    }

    // 4. GESIR NC (si affichée)
    if (typeof coucheGESIR_NC !== 'undefined' && map.hasLayer(coucheGESIR_NC)) {
        rafraichirCoucheGESIR('NC');
    }
	mettreAJourLongueurReseauAffiche();
	
	
}




function rafraichirCoucheGESIR(type) {
    if (type === 'C') {
        if (map.hasLayer(coucheGESIR_C)) map.removeLayer(coucheGESIR_C);
        if (donneesBrutesGESIR_C) {
            coucheGESIR_C = creerCoucheGESIRFiltree(donneesBrutesGESIR_C, 'GESIR26_RRN_C', gesirC_classesMasquees);
            coucheGESIR_C.addTo(map);
        }
    } else {
        if (map.hasLayer(coucheGESIR_NC)) map.removeLayer(coucheGESIR_NC);
        if (donneesBrutesGESIR_NC) {
            coucheGESIR_NC = creerCoucheGESIRFiltree(donneesBrutesGESIR_NC, 'GESIR26_RRN_C', gesirNC_classesMasquees);
            coucheGESIR_NC.addTo(map);
        }
    }
	mettreAJourLongueurReseauAffiche();
}

document.addEventListener("DOMContentLoaded", function() {
    if (typeof donneesGESIR26_C !== 'undefined') donneesBrutesGESIR_C = donneesGESIR26_C;
    if (typeof donneesGESIR26_NC !== 'undefined') donneesBrutesGESIR_NC = donneesGESIR26_NC;

    const btnGESIR_C = document.getElementById('btnToggleGESIR_C');
    const btnGESIR_NC = document.getElementById('btnToggleGESIR_NC');

    if (btnGESIR_C) {
        btnGESIR_C.addEventListener('click', function(e) {
            e.stopPropagation();
            const subOptsC_dyn = document.getElementById('subOptions_GESIR_C');
            
            if (map.hasLayer(coucheGESIR_C)) {
                map.removeLayer(coucheGESIR_C);
                btnGESIR_C.textContent = "❌";
                btnGESIR_C.title = "Afficher GESIR C";
                if (subOptsC_dyn) subOptsC_dyn.style.display = 'none';
            } else {
                // NE PAS faire gesirC_classesMasquees.clear() ici pour conserver les filtres actifs !
                rafraichirCoucheGESIR('C'); // La couche se rechargera en respectant les classes déjà masquées
                btnGESIR_C.textContent = "👁️";
                btnGESIR_C.title = "Masquer GESIR C";
                
                if (subOptsC_dyn) {
                    subOptsC_dyn.style.setProperty('display', 'flex', 'important');
                    subOptsC_dyn.querySelectorAll('.gesir-filter-item').forEach(item => {
                        item.style.setProperty('display', 'flex', 'important');
                    });
                }

                const btnToggleRRN_C = document.getElementById('btnToggleRRN_C');
                if (typeof coucheRRN_C !== 'undefined' && map.hasLayer(coucheRRN_C)) {
                    map.removeLayer(coucheRRN_C);
                    if (btnToggleRRN_C) { btnToggleRRN_C.textContent = "❌"; btnToggleRRN_C.title = "Afficher RRN C"; }
                }
            }
			mettreAJourLongueurReseauAffiche();
        });
    }

    if (btnGESIR_NC) {
        btnGESIR_NC.addEventListener('click', function(e) {
            e.stopPropagation();
            const subOptsNC_dyn = document.getElementById('subOptions_GESIR_NC');
            
            if (map.hasLayer(coucheGESIR_NC)) {
                map.removeLayer(coucheGESIR_NC);
                btnGESIR_NC.textContent = "❌";
                btnGESIR_NC.title = "Afficher GESIR NC";
                if (subOptsNC_dyn) subOptsNC_dyn.style.display = 'none';
            } else {
                // NE PAS faire gesirNC_classesMasquees.clear() ici non plus !
                rafraichirCoucheGESIR('NC'); // Respecte les filtres existants
                btnGESIR_NC.textContent = "👁️";
                btnGESIR_NC.title = "Masquer GESIR NC";
                
                if (subOptsNC_dyn) {
                    subOptsNC_dyn.style.setProperty('display', 'flex', 'important');
                    subOptsNC_dyn.querySelectorAll('.gesir-filter-item').forEach(item => {
                        item.style.setProperty('display', 'flex', 'important');
                    });
                }

                const btnToggleRRN_NC = document.getElementById('btnToggleRRN_NC');
                if (typeof coucheRRN_NC !== 'undefined' && map.hasLayer(coucheRRN_NC)) {
                    map.removeLayer(coucheRRN_NC);
                    if (btnToggleRRN_NC) { btnToggleRRN_NC.textContent = "❌"; btnToggleRRN_NC.title = "Afficher RRN NC"; }
                }
            }
			mettreAJourLongueurReseauAffiche();
        });
    }


// --- Écouteurs pour RRN C et RRN NC ---
const btnToggleRRN_C = document.getElementById('btnToggleRRN_C');
const btnToggleRRN_NC = document.getElementById('btnToggleRRN_NC');

if (btnToggleRRN_C) {
    btnToggleRRN_C.addEventListener('click', function(e) {
        e.stopPropagation();
        if (map.hasLayer(coucheRRN_C)) {
            map.removeLayer(coucheRRN_C);
            btnToggleRRN_C.textContent = "❌";
            btnToggleRRN_C.title = "Afficher RRN C";
        } else {
            coucheRRN_C.addTo(map);
            btnToggleRRN_C.textContent = "👁️";
            btnToggleRRN_C.title = "Masquer RRN C";
            
            // Optionnel : Masquer GESIR C si vous souhaitez les rendre exclusifs
            if (typeof coucheGESIR_C !== 'undefined' && map.hasLayer(coucheGESIR_C)) {
                map.removeLayer(coucheGESIR_C);
                const btnGESIR_C = document.getElementById('btnToggleGESIR_C');
                if (btnGESIR_C) { btnGESIR_C.textContent = "❌"; btnGESIR_C.title = "Afficher GESIR C"; }
                const subOptsC = document.getElementById('subOptions_GESIR_C');
                if (subOptsC) subOptsC.style.display = 'none';
            }
        }
		mettreAJourLongueurReseauAffiche();
    });
}

if (btnToggleRRN_NC) {
    btnToggleRRN_NC.addEventListener('click', function(e) {
        e.stopPropagation();
        if (map.hasLayer(coucheRRN_NC)) {
            map.removeLayer(coucheRRN_NC);
            btnToggleRRN_NC.textContent = "❌";
            btnToggleRRN_NC.title = "Afficher RRN NC";
        } else {
            coucheRRN_NC.addTo(map);
            btnToggleRRN_NC.textContent = "👁️";
            btnToggleRRN_NC.title = "Masquer RRN NC";
            
            // Optionnel : Masquer GESIR NC si vous souhaitez les rendre exclusifs
            if (typeof coucheGESIR_NC !== 'undefined' && map.hasLayer(coucheGESIR_NC)) {
                map.removeLayer(coucheGESIR_NC);
                const btnGESIR_NC = document.getElementById('btnToggleGESIR_NC');
                if (btnGESIR_NC) { btnGESIR_NC.textContent = "❌"; btnGESIR_NC.title = "Afficher GESIR NC"; }
                const subOptsNC = document.getElementById('subOptions_GESIR_NC');
                if (subOptsNC) subOptsNC.style.display = 'none';
            }
        }
		mettreAJourLongueurReseauAffiche();
    });
}


    // Écouteur global pour les clics sur les 6 traits de classification
    document.addEventListener('click', function(e) {
        const filterItem = e.target.closest('.gesir-filter-item');
        if (!filterItem) return;

        const layerType = filterItem.getAttribute('data-layer');
        const classVal = filterItem.getAttribute('data-class');
        const setMasques = (layerType === 'C') ? gesirC_classesMasquees : gesirNC_classesMasquees;

        const traitDiv = filterItem.querySelector('div');
        let croix = filterItem.querySelector('.croix-rouge');

        if (setMasques.has(classVal)) {
            setMasques.delete(classVal);
            if (traitDiv) traitDiv.style.opacity = '1';
            if (croix) croix.remove();
        } else {
            setMasques.add(classVal);
            if (traitDiv) traitDiv.style.opacity = '0.3';
            
            if (!croix) {
                croix = document.createElement('span');
                croix.className = 'croix-rouge';
                croix.innerText = '❌';
                croix.style.cssText = 'font-size: 10px; margin-left: 4px; line-height: 1;';
                filterItem.appendChild(croix); 
            }
        }

        rafraichirCoucheGESIR(layerType);
		mettreAJourLongueurReseauAffiche();
    });
	
	initialiserFiltreGestionnaire();
});




async function importerFichiersHTML(event) {
    const fichiers = event.target.files;
    if (!fichiers || fichiers.length === 0) return;

    // Vérification de la disponibilité de Capacitor Filesystem
    if (!window.Capacitor || !window.Capacitor.isNativePlatform()) {
        alert("L'importation de fichiers natifs est réservée à l'application mobile.");
        return;
    }

    const Filesystem = window.Capacitor.Plugins.Filesystem;
    const directoryEnum = (Filesystem.Directory && Filesystem.Directory.Documents) ? Filesystem.Directory.Documents : 'DOCUMENTS';

    let nbImportes = 0;

    try {
        // 1. S'assurer que le dossier Carto_PR existe (le crée si besoin)
        try {
            await Filesystem.mkdir({
                path: 'Carto_PR',
                directory: directoryEnum,
                recursive: true
            });
        } catch (err) {
            // Le dossier existe probablement déjà, on continue
        }

        // 2. Parcourir chaque fichier sélectionné par l'utilisateur
        for (let i = 0; i < fichiers.length; i++) {
            const fichier = fichiers[i];
            
            // On vérifie que c'est bien un fichier .html
            if (fichier.name.endsWith('.html')) {
                // Lecture du contenu du fichier sélectionné
                const contenuTexte = await lireFichierEnTexte(fichier);

                // Écriture du fichier dans le dossier Carto_PR de l'application
                await Filesystem.writeFile({
                    path: `Carto_PR/${fichier.name}`,
                    data: contenuTexte,
                    directory: directoryEnum,
                    encoding: 'utf8'
                });

                nbImportes++;
            }
        }

        alert(`${nbImportes} rapport(s) importé(s) avec succès !`);

        // 3. Recharger la liste déroulante des rapports pour les afficher immédiatement
        if (typeof chargerListeRapports === 'function') {
            chargerListeRapports();
        }

    } catch (e) {
        console.error("Erreur lors de l'importation des fichiers :", e);
        alert("Erreur lors de l'importation : " + (e.message || e));
    } finally {
        // Réinitialiser l'input pour permettre de ré-importer les mêmes fichiers si besoin
        event.target.value = '';
    }
}

// Fonction utilitaire pour lire un objet File en texte brut (Promesse)
function lireFichierEnTexte(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = (error) => reject(error);
        reader.readAsText(file, 'UTF-8');
    });
}




// Fonction globale pour afficher le résumé cartographique d'un rapport

async function ouvrirResumeRapport(nomFichier) {
    if (!nomFichier) {
        alert("Veuillez sélectionner un rapport.");
        return;
    }
    const contenu = await lireContenuRapport(nomFichier);
    if (!contenu) return;

    // Analyse du contenu HTML du rapport pour extraire les blocs d'événements et leurs coordonnées
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = contenu;
    const entries = tempDiv.querySelectorAll('.entry');
    
    let pointsRapport = [];

    entries.forEach(entry => {
        const titleB = entry.querySelector('b');
        const link = entry.querySelector('a');
        if (!titleB) return;

        const titleText = titleB.textContent;
        let typePoint = "clic"; // par défaut
        if (titleText.includes("Audio")) typePoint = "audio";
        else if (titleText.includes("Photo")) typePoint = "photo";
        else if (titleText.includes("Note")) typePoint = "note";

        // Extraction des coordonnées GPS depuis le lien ou le texte
        let lat = null, lon = null;
        if (link && link.href) {
            const regex = /query=([-\d.]+),([-\d.]+)/;
            const match = link.href.match(regex);
            if (match) {
                lat = parseFloat(match[1]);
                lon = parseFloat(match[2]);
            }
        }

        if (lat !== null && lon !== null) {
            // Extraction du numéro d'ordre
            const matchNumero = titleText.match(/^(\d+)/);
            const numeroPoint = matchNumero ? matchNumero[1] : '';

            // Génération du libellé pour le menu déroulant selon vos critères
            let labelSelect = `Point n° ${numeroPoint} : `;
            if (typePoint === "clic") {
                const matchAxe = entry.innerHTML.match(/Axe\s*:\s*([^,<\n]+)/i);
                const matchPr = entry.innerHTML.match(/PR\s*:\s*([^+<\n]+)\+(\d+)/i);
                const axeStr = matchAxe ? matchAxe[1].trim() : '';
                const prStr = matchPr ? matchPr[1].trim() + '+' + matchPr[2] : '';
                labelSelect += (axeStr || prStr) ? `${axeStr} - ${prStr}` : "Point cliqué";
            } else if (typePoint === "photo") {
                labelSelect += "photo";
            } else if (typePoint === "audio") {
                labelSelect += "audio";
            } else if (typePoint === "note") {
                labelSelect += "note";
            }

            pointsRapport.push({
                lat: lat,
                lon: lon,
                type: typePoint,
                htmlContent: entry.innerHTML,
                titleText: titleText,
                numero: numeroPoint,
                labelSelect: labelSelect
            });
        }
    });

    // Sélection du conteneur et du corps d'affichage du rapport
    const lecteurContainer = document.getElementById('lecteurRapportContainer');
    const contenuHtml = document.getElementById('contenuRapportHtml');

    if (!lecteurContainer || !contenuHtml) return;

    // Injection de la structure de la carte avec le menu déroulant dans l'en-tête
    contenuHtml.innerHTML = `
        <div style="position: relative; width: 100%; height: 100%; min-height: 400px; display: flex; flex-direction: column;">
            <div style="margin-bottom: 8px; font-size: 13px; color: #2c3e50; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;">
                <span>🗺️ <b>Résumé :</b> ${nomFichier} (${pointsRapport.length} points)</span>
                <select id="selectPointResume" style="font-size: 11px; padding: 4px; max-width: 320px; border-radius: 4px; border: 1px solid #ccc; background: white; cursor: pointer;">
                    <option value="">-- Sélectionner un point (${pointsRapport.length}) --</option>
                </select>
            </div>
            <div id="mapResumeContainer" style="width: 1000px; flex: 1; min-height: 350px; border-radius: 6px;"></div>
        </div>
    `;

    // Affichage du conteneur en mode plein écran (hauteur de 80vh)
    lecteurContainer.style.display = 'flex';
    lecteurContainer.style.height = '80vh';
    lecteurContainer.style.bottom = '0';
    lecteurContainer.style.left = '0';
    lecteurContainer.style.right = '0';
    lecteurContainer.style.top = 'auto';
    lecteurContainer.style.zIndex = '99999';
    contenuHtml.style.display = 'block';

    const btnReduire = document.getElementById('btnReduireRapport');
    if (btnReduire) btnReduire.textContent = "▼";

    // Interception des clics sur "Voir sur la carte" à l'intérieur des popups du résumé
    if (!contenuHtml.dataset.listenerAttached) {
        contenuHtml.dataset.listenerAttached = "true";
        contenuHtml.addEventListener('click', function(e) {
            const lien = e.target.closest('a');
            if (!lien) return;

            const href = lien.getAttribute('href');
            if (href && (href.includes('google.com/maps') || href.includes('query='))) {
                e.preventDefault();
                const regex = /query=([-\d.]+),([-\d.]+)/;
                const match = href.match(regex);

                if (match && match[1] && match[2]) {
                    const lat = parseFloat(match[1]);
                    const lon = parseFloat(match[2]);

                    if (window.mapResumeInstance) {
                        window.mapResumeInstance.closePopup();
                    }

                    trouverEtAfficherPointProche(lat, lon);
                    passerRapportEnModeReduit();
                } else {
                    window.open(href, '_blank');
                }
            }
        });
    }

    // Initialisation différée de la carte Leaflet
    setTimeout(() => {
        if (window.mapResumeInstance) {
            window.mapResumeInstance.remove();
        }

        const mapRes = L.map('mapResumeContainer').setView([46.5, 2], 6);
        window.mapResumeInstance = mapRes;

        L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap contributors'
        }).addTo(mapRes);

        const selectElement = document.getElementById('selectPointResume');
        const markersList = [];

        if (pointsRapport.length > 0) {
            const markersCoords = [];
            const positionsOccupees = [];

            pointsRapport.options = pointsRapport;
            pointsRapport.forEach((pt, idx) => {
                let latFinal = pt.lat;
                let lonFinal = pt.lon;

                // Anti-chevauchement des icônes proches
                let collision = positionsOccupees.find(p => Math.abs(p.lat - latFinal) < 0.00005 && Math.abs(p.lon - lonFinal) < 0.00005);
                if (collision) {
                    const angle = (idx * 45) * (Math.PI / 180);
                    const rayon = 0.00015;
                    latFinal += Math.sin(angle) * rayon;
                    lonFinal += Math.cos(angle) * rayon;

                    L.polyline([
                        [pt.lat, pt.lon],
                        [latFinal, lonFinal]
                    ], {
                        color: '#e74c3c',
                        weight: 1.5,
                        dashArray: '3, 3',
                        opacity: 0.8
                    }).addTo(mapRes);
                }

                positionsOccupees.push({ lat: latFinal, lon: lonFinal });

                let iconeMarqueur;
                if (pt.type === "clic") {
                    iconeMarqueur = new L.Icon({
                        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
                        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                        iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
                    });
                } else {
                    let emojiHtml = '📌';
                    if (pt.type === "audio") emojiHtml = '🎤';
                    else if (pt.type === "photo") emojiHtml = '📷';
                    else if (pt.type === "note") emojiHtml = '📖';

                    iconeMarqueur = L.divIcon({
                        className: 'custom-div-icon',
                        html: `<div style="background: white; border: 2px solid #333; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-size: 14px; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">${emojiHtml}</div>`,
                        iconSize: [28, 28],
                        iconAnchor: [14, 14],
                        popupAnchor: [0, -14]
                    });
                }

                const marker = L.marker([latFinal, lonFinal], { icon: iconeMarqueur }).addTo(mapRes);
                const entetePoint = pt.numero ? `<b>Point n°${pt.numero}</b><br>` : '';

                if (pt.type === "clic") {
                    const matchAxe = pt.htmlContent.match(/Axe\s*:\s*([^,<\n]+)/i);
                    const matchGvo = pt.htmlContent.match(/GVO\s*:\s*([^,<\n]+)/i);
                    const matchPr = pt.htmlContent.match(/PR\s*:\s*([^+<\n]+)\+(\d+)/i);
                    gpsLink = `<br><a href="https://www.google.com/maps/search/?api=1&query=${latFinal},${lonFinal}&basemap=roadmap" target="_blank" style="color: #3498db; font-size: 12px; text-decoration: none;">📍 Voir sur la carte</a>`;

                    let textePopup = `<div style="font-size: 12px; line-height: 1.4;">${entetePoint}`;
                    if (matchAxe || matchPr) {
                        textePopup += `
                            <b>Axe :</b> ${matchAxe ? matchAxe[1].trim() : 'N/A'}<br>
                            <b>GVO :</b> ${matchGvo ? matchGvo[1].trim() : 'N/A'}<br>
                            <b>PR + Abscisse :</b> ${matchPr ? matchPr[1].trim() + '+' + matchPr[2] : 'N/A'}<br>
                            ${gpsLink}<br>
                        `;
                    } else {
                        textePopup += `${pt.titleText}<br>`;
                    }
                    textePopup += `</div>`;
                    marker.bindPopup(textePopup);
                } else {
                    let contenuModifie = pt.htmlContent;
                    if (pt.numero) {
                        contenuModifie = contenuModifie.replace(/<b>\d+\s*-\s*\[.*?\]<\/b>/, `<b>Point n°${pt.numero}</b>`);
                    }
					contenuModifie = contenuModifie.replace(/📍\s*📍/g, '📍');
                    marker.bindPopup(`
                        <div style="max-width: 250px; max-height: 250px; overflow-y: auto; font-size: 12px;">
                            ${contenuModifie}
                        </div>
                    `);
                }

                // Ajout d'une option dans le menu déroulant
                if (selectElement) {
                    const opt = document.createElement('option');
                    opt.value = idx;
                    opt.textContent = pt.labelSelect;
                    selectElement.appendChild(opt);
                }

                markersList.push({ marker: marker, lat: latFinal, lon: lonFinal });
                markersCoords.push([pt.lat, pt.lon]);
            });

            // Gestion de la sélection dans le menu déroulant pour cibler le point
            if (selectElement) {
                selectElement.addEventListener('change', function() {
                    const idx = this.value;
                    if (idx !== "" && markersList[idx]) {
                        const item = markersList[idx];
                        mapRes.setView([item.lat, item.lon], 16);
                        item.marker.openPopup();
                    }
                });
            }

            mapRes.fitBounds(L.latLngBounds(markersCoords), { padding: [50, 50] });
        } else {
            alert("Aucune coordonnée GPS trouvée dans ce rapport.");
        }

        mapRes.invalidateSize();
    }, 200);
}

function attacherEvenementsLiensRapport() {
    const contenuHtml = document.getElementById('contenuRapportHtml') || document.getElementById('contenuRapportCorps');
    if (!contenuHtml) return;

    const liens = contenuHtml.querySelectorAll('a');
    liens.forEach(lien => {
        const href = lien.getAttribute('href');
        if (href && (href.includes('google.com/maps') || href.includes('query='))) {
            lien.addEventListener('click', function(e) {
                e.preventDefault();
                const regex = /query=([-\d.]+),([-\d.]+)/;
                const match = href.match(regex);

                if (match && match[1] && match[2]) {
                    const lat = parseFloat(match[1]);
                    const lon = parseFloat(match[2]);
                    trouverEtAfficherPointProche(lat, lon);
                    passerRapportEnModeReduit();
                } else {
                    window.open(href, '_blank');
                }
            });
        }
    });
}

function trouverEtAfficherPointProche(latClic, lonClic) {
    if (typeof map !== 'undefined') {
        map.setView([latClic, lonClic], 16);
    }


    const blueIcon = new L.Icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
    });

    const markerBleu = L.marker([latClic, lonClic], { icon: blueIcon });
    if (!MarkBleuMasque) {
        markerBleu.addTo(map);
    }
    blueMarkers.push(markerBleu);

    injecterScript('FICHIERS/AXES/index_axes.js', () => {
        const indexAxes = window.INDEX_AXES || [];
        if (indexAxes.length === 0) return;

        let meilleurPointGlobal = null;
        let distMinGlobal = Infinity;
        const axesCandidats = [...new Set(indexAxes.map(p => p.axe))];

        function chercherDansAxesIndex(index) {
            if (index >= axesCandidats.length) {
                if (meilleurPointGlobal) {
                    // Si le point trouvé possède une abscisse non nulle, on force l'affichage de la borne orange
                    if (meilleurPointGlobal[2] !== 0 && typeof afficherBorneClic === 'function') {
                        afficherBorneClic(meilleurPointGlobal);
                    } else if (typeof window.creerBorneVisuelleStandard === 'function') {
                        window.creerBorneVisuelleStandard(meilleurPointGlobal);
                    }
                }
                return;
            }

            const axeCourant = axesCandidats[index];
            chargerFichierAxe(axeCourant, (donneesAxe) => {
                donneesAxe.forEach(p => {
                    const d = Math.pow(p[3] - latClic, 2) + Math.pow(p[4] - lonClic, 2);
                    if (d < distMinGlobal) {
                        distMinGlobal = d;
                        meilleurPointGlobal = p;
                    }
                });
                chercherDansAxesIndex(index + 1);
            });
        }
        chercherDansAxesIndex(0);
    });
}

// Gestion de l'affichage réduit en bas de l'écran avec flexbox
function passerRapportEnModeReduit() {
    const conteneur = document.getElementById('lecteurRapportContainer');
    if (!conteneur) return;

    conteneur.style.display = 'flex';
    conteneur.style.height = '45px';
    conteneur.style.bottom = '0';
    conteneur.style.left = '0';
    conteneur.style.right = '0';
    conteneur.style.top = 'auto';
    conteneur.style.zIndex = '99999';

    const corps = document.getElementById('contenuRapportHtml');
    if (corps) corps.style.display = 'none';

    const btnReduire = document.getElementById('btnReduireRapport');
    if (btnReduire) btnReduire.textContent = "▲";
}

document.addEventListener('DOMContentLoaded', function() {
    const headerReduit = document.getElementById('rapportHeader');
    const btnReduire = document.getElementById('btnReduireRapport');
    
    if (headerReduit) {
        headerReduit.addEventListener('click', function(e) {
            if (e.target.id === 'btnFermerRapport') return;

            const conteneur = document.getElementById('lecteurRapportContainer');
            const corps = document.getElementById('contenuRapportHtml');
            
            if (conteneur) {
                if (conteneur.style.height === '45px') {
                    conteneur.style.height = '80vh';
                    if (corps) corps.style.display = 'block';
                    if (btnReduire) btnReduire.textContent = "▼";
                } else {
                    conteneur.style.height = '45px';
                    if (corps) corps.style.display = 'none';
                    if (btnReduire) btnReduire.textContent = "▲";
                }
            }
        });
    }

    if (btnReduire) {
        btnReduire.addEventListener('click', function(e) {
            e.stopPropagation();
            const conteneur = document.getElementById('lecteurRapportContainer');
            const corps = document.getElementById('contenuRapportHtml');
            if (conteneur.style.height === '45px') {
                conteneur.style.height = '80vh';
                if (corps) corps.style.display = 'block';
                btnReduire.textContent = "▼";
            } else {
                conteneur.style.height = '45px';
                if (corps) corps.style.display = 'none';
                btnReduire.textContent = "▲";
            }
        });
    }
});

async function chargerListeRapports() {
    const select = document.getElementById('selectRapports');
    if (!select) return;
    select.innerHTML = '<option value="">-- Sélectionnez un rapport --</option>';

    let listeFichiers = [];

    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        try {
            const Filesystem = window.Capacitor.Plugins.Filesystem;
            if (!Filesystem) throw new Error("Filesystem plugin non disponible");
            
            const directoryEnum = (Filesystem.Directory && Filesystem.Directory.Documents) ? Filesystem.Directory.Documents : 'DOCUMENTS';
            const result = await Filesystem.readdir({ path: 'Carto_PR', directory: directoryEnum });

            if (result && result.files) {
                result.files.forEach(file => {
                    const fileName = typeof file === 'string' ? file : (file.name || file.uri);
                    if (fileName && fileName.endsWith('.html')) {
                        listeFichiers.push(fileName);
                    }
                });
            }
        } catch (e) {
            console.log("Dossier Carto_PR vide ou inexistant :", e);
        }
    } else {
        // Mode PWA / Web : Récupération des clés depuis IndexedDB
        try {
            const keys = await idbGetAllKeys();
            keys.forEach(key => {
                if (key && key.endsWith('.html')) {
                    listeFichiers.push(key);
                }
            });
        } catch (e) {
            console.error("Erreur de lecture IndexedDB :", e);
        }
    }

    // Tri par ordre chronologique descendant (le plus récent en haut)
    // Basé sur le format de nommage (ex: YYYYMMDD_HHMMSS) ou ordre alphabétique inverse par défaut
    listeFichiers.sort((a, b) => b.localeCompare(a, 'fr', { numeric: true }));

    // Injection des options triées dans le menu déroulant
    listeFichiers.forEach(fileName => {
        const opt = document.createElement('option');
        opt.value = fileName;
        opt.textContent = fileName;
        select.appendChild(opt);
    });
}

async function lireContenuRapport(nomFichier) {
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        try {
            const Filesystem = window.Capacitor.Plugins.Filesystem;
            if (!Filesystem) throw new Error("Filesystem plugin non disponible");
            const directoryEnum = (Filesystem.Directory && Filesystem.Directory.Documents) ? Filesystem.Directory.Documents : 'DOCUMENTS';
            const res = await Filesystem.readFile({
                path: `Carto_PR/${nomFichier}`,
                directory: directoryEnum,
                encoding: 'utf8'
            });
            return res.data;
        } catch (e) {
            alert("Erreur de lecture du rapport : " + (e.message || JSON.stringify(e)));
            return null;
        }
    } else {
        return await idbGetItem(nomFichier);
    }
}

document.addEventListener("DOMContentLoaded", function() {
    chargerListeRapports();

    const btnOuvrir = document.getElementById('btnOuvrirRapport');
    const btnPartager = document.getElementById('btnPartagerRapport');
    const btnFermer = document.getElementById('btnFermerRapport');
    const selectRapports = document.getElementById('selectRapports');
    const lecteurContainer = document.getElementById('lecteurRapportContainer');
    const contenuHtml = document.getElementById('contenuRapportHtml');

    if (selectRapports) {
        selectRapports.style.width = '100%';
        selectRapports.style.maxWidth = '300px';
    }

    if (btnOuvrir) {
        btnOuvrir.onclick = async function() {
            const val = selectRapports.value;
            if (!val) {
                alert("Veuillez sélectionner un rapport.");
                return;
            }
            const contenu = await lireContenuRapport(val);
            if (contenu) {
                if (lecteurContainer && contenuHtml) {
                    contenuHtml.innerHTML = contenu;
                    contenuHtml.style.display = 'block';
                    lecteurContainer.style.display = 'flex';
                    lecteurContainer.style.height = '80vh';
                    lecteurContainer.style.zIndex = '99999';
                    const btnReduire = document.getElementById('btnReduireRapport');
                    if (btnReduire) btnReduire.textContent = "▼";
                    attacherEvenementsLiensRapport();
                }
            }
        };
    }

    if (btnFermer) {
        btnFermer.onclick = function() {
            if (lecteurContainer) lecteurContainer.style.display = 'none';
            if (contenuHtml) contenuHtml.innerHTML = '';
        };
    }

    if (btnPartager) {
        btnPartager.onclick = async function() {
            const val = selectRapports.value;
            if (!val) {
                alert("Veuillez sélectionner un rapport à partager.");
                return;
            }

            const isCapacitorNative = window.Capacitor && 
                                      window.Capacitor.isNativePlatform && 
                                      window.Capacitor.isNativePlatform();

            if (isCapacitorNative) {
                try {
                    const Filesystem = window.Capacitor.Plugins.Filesystem;
                    const Share = window.Capacitor.Plugins.Share;
                    const directoryEnum = (Filesystem && Filesystem.Directory) ? Filesystem.Directory.Documents : 'DOCUMENTS';

                    const fileUriResult = await Filesystem.getUri({
                        directory: directoryEnum,
                        path: `Carto_PR/${val}`
                    });

                    if (Share && typeof Share.share === 'function') {
                        await Share.share({
                            title: 'Partager le rapport',
                            text: `Rapport Carto : ${val}`,
                            files: [fileUriResult.uri],
                            dialogTitle: 'Partager via'
                        });
                    } else {
                        throw new Error("Le plugin Share de Capacitor n'est pas disponible.");
                    }
                } catch (e) {
                    alert("Erreur lors du partage : " + (e.message || JSON.stringify(e)));
                }
            } else {
                if (navigator.share) {
                    try {
                        await navigator.share({ title: 'Rapport Carto', text: `Rapport : ${val}` });
                    } catch (err) {
                        console.log("Partage annulé ou non pris en charge", err);
                    }
                } else {
                    const contenuSecours = await lireContenuRapport(val);
                    if (contenuSecours) {
                        const blob = new Blob([contenuSecours], { type: 'text/html;charset=utf-8' });
                        const lien = document.createElement('a');
                        lien.href = URL.createObjectURL(blob);
                        lien.download = val;
                        lien.click();
                        URL.revokeObjectURL(lien.href);
                    } else {
                        alert("Partage non disponible.");
                    }
                }
            }
        };
    }
});



/* ---------------- FONCTIONS GLOBALES D'OUVERTURE DES DOCUMENTS (NOUVEL ONGLET) ---------------- */

async function ouvrirPdfNatif(nomFichier) {
    const cheminRelatif = 'FICHIERS/' + nomFichier;

    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        try {
            const Filesystem = window.Capacitor.Plugins.Filesystem;
            const FileOpener = window.Capacitor.Plugins.FileOpener;
            
            const Directory = (Filesystem && Filesystem.Directory) 
                || window.Capacitor.Directory 
                || 'CACHE';

            // 1. Charger le fichier local (www) via fetch sous forme de Blob
            const response = await fetch(cheminRelatif);
            if (!response.ok) {
                throw new Error("Impossible de charger le fichier local (code " + response.status + ")");
            }
            const blob = await response.blob();

            // 2. Convertir le Blob en chaîne Base64
            const base64Data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onerror = reject;
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.readAsDataURL(blob);
            });

            // 3. Écrire le fichier dans le répertoire CACHE
            const tempFilePath = nomFichier;
            await Filesystem.writeFile({
                path: tempFilePath,
                data: base64Data,
                directory: Directory.Cache || Directory
            });

            // 4. Obtenir l'URI native du fichier écrit
            const fileUriResult = await Filesystem.getUri({
                directory: Directory.Cache || Directory,
                path: tempFilePath
            });

            // 5. Ouvrir le fichier avec l'application Android par défaut
            await FileOpener.open({
                filePath: fileUriResult.uri,
                contentType: 'application/pdf'
            });

        } catch (erreur) {
            alert("Erreur lors de l'ouverture du PDF : " + (erreur.message || JSON.stringify(erreur)));
        }
    } else {
        // Fallback Web sur PC
        window.open(cheminRelatif, '_blank');
    }
}
// Liaisons avec vos fonctions globales
window.ouvrirDonnees = function() { ouvrirPdfNatif('Data.pdf'); };
window.ouvrirAvertissement = function() { ouvrirPdfNatif('Avertissement.pdf'); };
window.ouvrirAide = function() { ouvrirPdfNatif('Carto_PR_help.pdf'); };


/* ---------------- FONCTIONS DE GESTION DE LA TAILLE DES ICÔNES ---------------- */

function appliquerZoomIconesManuel() {
    // On applique une variable CSS globale sur le conteneur de la carte
    const mapElement = document.getElementById('map');
    if (mapElement) {
        mapElement.style.setProperty('--echelle-icones-perso', facteurZoomIcones);
    }
}

window.stationsCarrefoursTrouvees = (function() {
    try {
        const localData = localStorage.getItem('stations_carrefours_json');
        return localData ? JSON.parse(localData) : null;
    } catch (e) {
        console.error("Erreur de lecture du localStorage pour les carrefours:", e);
        return null;
    }
})();
let coucheCarrefours = L.layerGroup();
// -----------------------------------------------------------------------

// Cache pour stocker les axes complets une fois chargés
const axesCharges = {};


let coucheAiresC = null;
let coucheAiresNC = null;
let couchePeages = null;



/* ---------------- INITIALISATION DE LA CARTE ---------------- */
const osm = L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
});

const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { 
    maxZoom: 19 
});

map = L.map('map', {
    center: [46.5, 2],
    zoom: 6
});
osm.addTo(map);

window.addEventListener('resize', function() {
    if (map) {
        map.invalidateSize();
    }
});

// 1. Créer un pane personnalisé pour les points
map.createPane('pointsAuDessus');

// 2. Définir un zIndex très élevé (par défaut, le markerPane est à 600)
map.getPane('pointsAuDessus').style.zIndex = 650;

// Ajout du conteneur global des points exacts à la carte
containerPointsTous.addTo(map);
containerPointsBlancs.addTo(containerPointsTous);
containerPointsRouges.addTo(containerPointsTous);




const baseMaps = { "OSM": osm, "Satellite": sat };
L.control.layers(baseMaps, null, { collapsed: false }).addTo(map);

// --- BOUTON DE GÉOLOCALISATION EN TEMPS RÉEL SUR LA CARTE LEAFLET ---

// --- BOUTON DE GÉOLOCALISATION EN TEMPS RÉEL SUR LA CARTE LEAFLET ---

let userLocationMarker = null;
let userLocationCircle = null;
let isTracking = false;
let watchId = null;
let currentLatLng = null;

// Variable pour détecter si l'utilisateur navigue manuellement sur la carte
let userIsNavigating = false;
// Verrou pour différencier les déplacements automatiques des déplacements manuels
let isProgrammaticMove = false;

// Création d'un bouton personnalisé sur la carte
const locateControl = L.control({ position: 'topleft' });

locateControl.onAdd = function (map) {
    const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
    div.style.backgroundColor = 'white';
    div.style.width = '34px';
    div.style.height = '34px';
    div.style.lineHeight = '34px';
    div.style.textAlign = 'center';
    div.style.cursor = 'pointer';
    div.style.fontSize = '18px';
    div.title = "Me géolocaliser / Suivre ma position";
    div.innerHTML = '🎯';

    // Détection d'une navigation manuelle réelle par l'utilisateur (hors mouvements automatiques)
    map.on('dragstart movestart', function() {
        if (isTracking && !isProgrammaticMove) {
            userIsNavigating = true;
        }
    });

    div.onclick = function (e) {
        L.DomEvent.stopPropagation(e); // Évite de cliquer sur la carte en même temps
        
        if (!isTracking) {
            if ("geolocation" in navigator) {
                isTracking = true;
                userIsNavigating = false; // Réinitialise l'état de navigation au démarrage
                div.style.backgroundColor = '#e0f2fe'; // Indique visuellement que le suivi est actif

                watchId = navigator.geolocation.watchPosition(
                    function (position) {
                        const lat = position.coords.latitude;
                        const lng = position.coords.longitude;
                        const accuracy = position.coords.accuracy;
                        const radius = accuracy / 2;
                        const latlng = L.latLng(lat, lng);

                        const isFirstLocation = !currentLatLng;
                        currentLatLng = latlng;

                        // Mise à jour ou création du cercle de précision
                        if (userLocationCircle) {
                            userLocationCircle.setLatLng(latlng);
                            userLocationCircle.setRadius(radius);
                        } else {
                            userLocationCircle = L.circle(latlng, radius, {
                                color: '#1a5ff3',
                                fillColor: '#1a5ff3',
                                fillOpacity: 0.15,
                                weight: 1
                            }).addTo(map);
                        }

                        // Mise à jour ou création du marqueur
                        if (userLocationMarker) {
                            userLocationMarker.setLatLng(latlng);
                            userLocationMarker.getPopup().setContent("Vous êtes à moins de " + Math.round(radius) + " mètres de ce point");
                        } else {
                            userLocationMarker = L.circleMarker(latlng, {
                            radius: 8,
                            fillColor: '#1a5ff3', 
                            color: '#ffffff',
                            weight: 2,
                            fillOpacity: 1
                            }).addTo(map)
                                .bindPopup("Vous êtes à moins de " + Math.round(radius) + " mètres de ce point");
                        }

                        // Recentrage automatique si première localisation ou si l'utilisateur ne navigue pas manuellement
                        if (isFirstLocation || !userIsNavigating) {
                            isProgrammaticMove = true;
                            map.setView(latlng, Math.max(map.getZoom(), 16));
                            isProgrammaticMove = false;
                        }
                    },
                    function (err) {
                        alert("Impossible de vous géolocaliser : " + err.message);
                    },
                    { enableHighAccuracy: true }
                );
            } else {
                alert("La géolocalisation n'est pas supportée par votre appareil.");
            }
        } else if (currentLatLng) {
            // Clic sur le bouton de géolocalisation : on réactive le recentrage et annule la navigation manuelle
            userIsNavigating = false;
            isProgrammaticMove = true;
            map.setView(currentLatLng, Math.max(map.getZoom(), 16));
            isProgrammaticMove = false;
        }
    };

    return div;
};

locateControl.addTo(map);


//Sauvegarde des rapports sous IOS

function ouvrirBDD() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("CartoPR_DB", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains("rapports")) {
                db.createObjectStore("rapports"); // La clé sera le nom du fichier (.html)
            }
        };
    });
}

async function idbSetItem(nomFichier, contenu) {
    const db = await ouvrirBDD();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("rapports", "readwrite");
        const store = transaction.objectStore("rapports");
        const request = store.put(contenu, nomFichier);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function idbGetItem(nomFichier) {
    const db = await ouvrirBDD();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("rapports", "readonly");
        const store = transaction.objectStore("rapports");
        const request = store.get(nomFichier);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function idbGetAllKeys() {
    const db = await ouvrirBDD();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("rapports", "readonly");
        const store = transaction.objectStore("rapports");
        const request = store.getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}


// --- BOUTON D'ENREGISTREMENT FICHIER TEXTE SOUS LA GÉOLOCALISATION ---

let isRecording = false;
let currentFileName = "";
let currentFileContent = "";

const recordControl = L.control({ position: 'topleft' });

recordControl.onAdd = function (map) {
    const containerDiv = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
    containerDiv.style.display = 'flex';
    containerDiv.style.flexDirection = 'column';
    containerDiv.style.gap = '4px';
    containerDiv.style.background = 'transparent';
    containerDiv.style.border = 'none';
    containerDiv.style.boxShadow = 'none';

    const div = L.DomUtil.create('div', '', containerDiv);
    div.style.backgroundColor = 'white';
    div.style.width = '34px';
    div.style.height = '34px';
    div.style.lineHeight = '34px';
    div.style.textAlign = 'center';
    div.style.cursor = 'pointer';
    div.style.fontSize = '18px';
    div.title = "Démarrer l'enregistrement";
    let imgPath = "FICHIERS/Suivi.png";
if (window.Capacitor && window.Capacitor.isNativePlatform()) {
    // Sur mobile, force le chemin relatif à la racine du serveur web local de l'application
    imgPath = "./FICHIERS/Suivi.png"; 
}

div.innerHTML = `<img src="${imgPath}" alt="Suivi" style="width: 28px; height: 28px; vertical-align: middle;" />`;

    // Conteneur des 3 boutons supplémentaires (micro, appareil photo, stylo)
    const extraButtonsDiv = L.DomUtil.create('div', '', containerDiv);
    extraButtonsDiv.id = 'recordingExtraButtons';
    extraButtonsDiv.style.display = 'none';
    extraButtonsDiv.style.flexDirection = 'column';
    extraButtonsDiv.style.gap = '4px';

    // Bouton Micro
    const btnMic = L.DomUtil.create('div', '', extraButtonsDiv);
    btnMic.style.backgroundColor = 'white';
    btnMic.style.width = '34px';
    btnMic.style.height = '34px';
    btnMic.style.lineHeight = '34px';
    btnMic.style.textAlign = 'center';
    btnMic.style.cursor = 'pointer';
    btnMic.style.fontSize = '16px';
    btnMic.title = "Enregistrement vocal";
    btnMic.innerHTML = '🎤';

    // Bouton Appareil photo
    const btnCam = L.DomUtil.create('div', '', extraButtonsDiv);
    btnCam.style.backgroundColor = 'white';
    btnCam.style.width = '34px';
    btnCam.style.height = '34px';
    btnCam.style.lineHeight = '34px';
    btnCam.style.textAlign = 'center';
    btnCam.style.cursor = 'pointer';
    btnCam.style.fontSize = '16px';
    btnCam.title = "Prendre une photo";
    btnCam.innerHTML = '📷';

    // Bouton Stylo
    const btnPen = L.DomUtil.create('div', '', extraButtonsDiv);
    btnPen.style.backgroundColor = 'white';
    btnPen.style.width = '34px';
    btnPen.style.height = '34px';
    btnPen.style.lineHeight = '34px';
    btnPen.style.textAlign = 'center';
    btnPen.style.cursor = 'pointer';
    btnPen.style.fontSize = '16px';
    btnPen.title = "Écrire du texte mis en forme";
    btnPen.innerHTML = '✏️';

   // Logique Bouton Micro
    let mediaRecorderGlobal = null;
let audioChunksGlobal = [];

btnMic.onclick = async function(e) {
    L.DomEvent.stopPropagation(e);
    const numEvent = ++rapportIndexEvent;
    if (!isRecording) return;

    try {
        if (!mediaRecorderGlobal || mediaRecorderGlobal.state === "inactive") {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorderGlobal = new MediaRecorder(stream);
            audioChunksGlobal = [];

            mediaRecorderGlobal.ondataavailable = event => {
                if (event.data && event.data.size > 0) {
                    audioChunksGlobal.push(event.data);
                }
            };

            mediaRecorderGlobal.onstop = () => {
                    const audioBlob = new Blob(audioChunksGlobal, { type: 'audio/webm' });
                    const reader = new FileReader();
                    reader.onload = function() {
                        const base64Audio = reader.result;
                        const maintenant = new Date();
                        const timestamp = `${String(maintenant.getHours()).padStart(2, '0')}h${String(maintenant.getMinutes()).padStart(2, '0')}m${String(maintenant.getSeconds()).padStart(2, '0')}s`;

                        let gpsText = "";
                        let gpsLink = "";
                        if (currentLatLng) {
                            const lat = currentLatLng.lat;
                            const lng = currentLatLng.lng;
                            const lng2 = currentLatLng.lng.toFixed(6);
                            const lat2 = currentLatLng.lat.toFixed(6);
                            
                            gpsText = ` - ${lat2}, ${lng2}`;
                            gpsLink = `<br><a href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}&basemap=roadmap" target="_blank" style="color: #3498db; font-size: 12px; text-decoration: none;">📍 Voir sur la carte</a>`;
                        }

                        currentFileContent += `
    <div class="entry">
        <b>${numEvent} - [Audio - ${timestamp}${gpsText}]</b>${gpsLink}<br>
        <audio controls src="${base64Audio}" style="margin-top: 8px; width: 100%;"></audio>
    </div>
`;
                        alert("Enregistrement vocal inséré dans le fichier.");
                    };
                    reader.readAsDataURL(audioBlob);
                    stream.getTracks().forEach(track => track.stop());
                };

                mediaRecorderGlobal.start();
                btnMic.style.backgroundColor = '#ff3b30'; // Indique que le micro écoute
                alert("Enregistrement vocal démarré. Cliquez à nouveau sur le micro pour l'arrêter.");
            } else {
            // Deuxième clic : on arrête l'enregistrement
            mediaRecorderGlobal.stop();
            btnMic.style.backgroundColor = 'white';
        }
    } catch (err) {
        alert("Erreur micro : " + err.message);
    }
};

    // Logique Bouton Appareil Photo
    btnCam.onclick = function(e) {
        L.DomEvent.stopPropagation(e);
        const numEvent = ++rapportIndexEvent;
        if (!isRecording) return;
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.capture = 'environment';
        fileInput.onchange = function(event) {
            const file = event.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    const base64Image = e.target.result;
                    const maintenant = new Date();
                    const timestamp = `${String(maintenant.getHours()).padStart(2, '0')}h${String(maintenant.getMinutes()).padStart(2, '0')}m${String(maintenant.getSeconds()).padStart(2, '0')}s`;
                    
                    let gpsText = "";
                    let gpsLink = "";
                    if (currentLatLng) {
                        const lat = currentLatLng.lat;
                            const lng = currentLatLng.lng;
                            const lng2 = currentLatLng.lng.toFixed(6);
                            const lat2 = currentLatLng.lat.toFixed(6);
                            
                            gpsText = ` - ${lat2}, ${lng2}`;
                        gpsLink = `<br><a href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}&basemap=roadmap" target="_blank" style="color: #3498db; font-size: 12px; text-decoration: none;">📍 Voir sur la carte</a>`;
                    }

                    currentFileContent += `
    <div class="entry">
        <b>${numEvent} - [Photo - ${timestamp}${gpsText}]</b>${gpsLink}<br>
        <img src="${base64Image}" alt="Photo ${timestamp}">
    </div>
`;
                    alert("Photo insérée dans le document texte.");
                };
                reader.readAsDataURL(file);
            }
        };
        fileInput.click();
    };

    // Logique Bouton Stylo (Popup de texte enrichi)
    btnPen.onclick = function(e) {
        L.DomEvent.stopPropagation(e);
        const numEvent = ++rapportIndexEvent;
        if (!isRecording) return;

        // Création de la modale de texte enrichi
        const modalOverlay = document.createElement('div');
        modalOverlay.style.position = 'fixed';
        modalOverlay.style.top = '0';
        modalOverlay.style.left = '0';
        modalOverlay.style.width = '100vw';
        modalOverlay.style.height = '100vh';
        modalOverlay.style.backgroundColor = 'rgba(0,0,0,0.5)';
        modalOverlay.style.zIndex = '100000';
        modalOverlay.style.display = 'flex';
        modalOverlay.style.alignItems = 'center';
        modalOverlay.style.justifyContent = 'center';

        const modalContent = document.createElement('div');
        modalContent.style.background = 'white';
        modalContent.style.padding = '15px';
        modalContent.style.borderRadius = '8px';
        modalContent.style.width = '90%';
        modalContent.style.maxWidth = '400px';
        modalContent.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
        modalContent.style.display = 'flex';
        modalContent.style.flexDirection = 'column';
        modalContent.style.gap = '10px';

        // Barre d'outils de mise en forme
        const toolbar = document.createElement('div');
        toolbar.style.display = 'flex';
        toolbar.style.gap = '5px';

        const btnBold = document.createElement('button');
        btnBold.innerText = 'B';
        btnBold.style.fontWeight = 'bold';
        btnBold.onclick = () => document.execCommand('bold', false, null);

        const btnItalic = document.createElement('button');
        btnItalic.innerText = 'I';
        btnItalic.style.fontStyle = 'italic';
        btnItalic.onclick = () => document.execCommand('italic', false, null);

        const btnUnderline = document.createElement('button');
        btnUnderline.innerText = 'U';
        btnUnderline.style.textDecoration = 'underline';
        btnUnderline.onclick = () => document.execCommand('underline', false, null);

        toolbar.appendChild(btnBold);
        toolbar.appendChild(btnItalic);
        toolbar.appendChild(btnUnderline);

        // Zone de texte éditable
        const editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.style.border = '1px solid #ccc';
        editor.style.minHeight = '120px';
        editor.style.padding = '8px';
        editor.style.borderRadius = '4px';
        editor.style.backgroundColor = '#fafafa';

        // Bouton de fermeture / validation
        const btnClose = document.createElement('button');
        btnClose.innerText = 'Valider et Fermer';
        btnClose.style.backgroundColor = '#2ec4b6';
        btnClose.style.color = 'white';
        btnClose.style.border = 'none';
        btnClose.style.padding = '8px';
        btnClose.style.borderRadius = '4px';
        btnClose.style.cursor = 'pointer';
        btnClose.style.fontWeight = 'bold';

        btnClose.onclick = function() {
            const htmlText = editor.innerHTML;
            const plainText = editor.innerText;
            const maintenant = new Date();
            const timestamp = `${String(maintenant.getHours()).padStart(2, '0')}h${String(maintenant.getMinutes()).padStart(2, '0')}m${String(maintenant.getSeconds()).padStart(2, '0')}s`;
            if (plainText.trim() !== "") {
                let gpsText = "";
                let gpsLink = "";
                if (currentLatLng) {
                    const lat = currentLatLng.lat;
                            const lng = currentLatLng.lng;
                            const lng2 = currentLatLng.lng.toFixed(6);
                            const lat2 = currentLatLng.lat.toFixed(6);
                            
                            gpsText = ` - ${lat2}, ${lng2}`;
                    gpsLink = `<br><a href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}&basemap=roadmap" target="_blank" style="color: #3498db; font-size: 12px; text-decoration: none;">📍 Voir sur la carte</a>`;
                
                }
                currentFileContent += `
            <div class="entry">
            <b>${numEvent} - [Note - ${timestamp}${gpsText}]</b>${gpsLink}<br>
            <p>${plainText.replace(/\n/g, '<br>')}</p>
            </div>
            `;
            }
            document.body.removeChild(modalOverlay);
        };

        modalContent.appendChild(toolbar);
        modalContent.appendChild(editor);
        modalContent.appendChild(btnClose);
        modalOverlay.appendChild(modalContent);
        document.body.appendChild(modalOverlay);
    };

    div.onclick = async function (e) {
        L.DomEvent.stopPropagation(e);

        if (!isRecording) {
            // 1. Démarrage de l'enregistrement
            rapportIndexEvent = 0;
            isRecording = true;
            div.style.backgroundColor = '#fee2e2';
            div.innerHTML = '<span style="display: inline-block; width: 14px; height: 14px; background-color: #ff3b30; border-radius: 50%; vertical-align: middle; box-shadow: 0 0 4px rgba(255, 59, 48, 0.6);"></span>';
            div.title = "Enregistrement en cours... Cliquer pour sauvegarder et fermer";
            
            // Afficher les boutons supplémentaires
            extraButtonsDiv.style.display = 'flex';

            const maintenant = new Date();
            const annee = maintenant.getFullYear();
            const mois = String(maintenant.getMonth() + 1).padStart(2, '0');
            const jour = String(maintenant.getDate()).padStart(2, '0');
            const heures = String(maintenant.getHours()).padStart(2, '0');
            const minutes = String(maintenant.getMinutes()).padStart(2, '0');

            currentFileName = `${annee}${mois}${jour}_${heures}${minutes}${String(maintenant.getSeconds()).padStart(2, '0')}.html`;currentFileContent = `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rapport Carto ${annee}-${mois}-${jour}</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 15px; background-color: #f9f9f9; color: #333; }
        .entry { background: white; padding: 12px; margin-bottom: 15px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        img { max-width: 100%; height: auto; border-radius: 6px; margin-top: 8px; display: block; }
        audio { width: 100%; margin-top: 8px; }
        hr { border: 0; border-top: 1px solid #ddd; margin: 15px 0; }
    </style>
</head>
<body>
    <h2>Rapport du ${jour}/${mois}/${annee} à ${heures}h${minutes}</h2>
    <hr>
`;

        } else {
    // 2. Arrêt et enregistrement du fichier en mode Web/PWA
    isRecording = false;
    div.style.backgroundColor = 'white';
    let imgPath = "FICHIERS/Suivi.png";
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        imgPath = "./FICHIERS/Suivi.png"; 
    }

    div.innerHTML = `<img src="${imgPath}" alt="Suivi" style="width: 28px; height: 28px; vertical-align: middle;" />`;
    div.title = "Démarrer l'enregistrement";

    extraButtonsDiv.style.display = 'none';

    try {
        currentFileContent += `</body></html>`;
        
        if (window.Capacitor && window.Capacitor.isNativePlatform()) {
            const fs = window.Capacitor.Plugins.Filesystem;
            if (!fs) throw new Error("Filesystem plugin non disponible");

            let targetDir = 'DOCUMENTS';
            if (fs.Directory) {
                targetDir = fs.Directory.Documents || fs.Directory.ExternalStorage || 'DOCUMENTS';
            }

            await fs.mkdir({
                path: 'Carto_PR',
                directory: targetDir,
                recursive: true
            }).catch(() => {});

            await fs.writeFile({
                path: `Carto_PR/${currentFileName}`,
                data: currentFileContent,
                directory: targetDir,
                encoding: 'utf8'
            });

            if (typeof chargerListeRapports === 'function') {
                await chargerListeRapports();
            }
            alert(`Rapport enregistré !`);
        } else {
            // Mode Web / PWA (Safari / iPhone) : Stockage dans IndexedDB + Téléchargement direct en secours
            await idbSetItem(currentFileName, currentFileContent);

            const blob = new Blob([currentFileContent], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = currentFileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            if (typeof chargerListeRapports === 'function') {
                await chargerListeRapports();
            }
            alert("Rapport enregistré !");
        }
    } catch (erreur) {
        console.error("Erreur d'enregistrement :", erreur);
        alert("Erreur lors de l'enregistrement : " + (erreur.message || JSON.stringify(erreur)));
    }
}
    };

    return containerDiv;
};

recordControl.addTo(map);



/* ---------------- FONCTIONS DE CRÉATION DES POINTS PRÉCIS ---------------- */

/**
 * Crée un point précis (CircleMarker) aux coordonnées exactes.
 * Un clic copie les coordonnées exactes via copierDansPressePapier.
 */
function creerPointPrecis(lat, lon, couleurFond, parentGroup = containerPointsTous) {
    const pt = L.circleMarker([lat, lon], {
        radius: 5,
        fillColor: couleurFond,
        pane: 'pointsAuDessus',
        color: '#000000',      // Bordure noire pour une netteté maximale
        weight: 1.5,
        opacity: 1,
        fillOpacity: 1,
        interactive: true
    });

    // 1. Contenu HTML du popup
    const popupContent = `
        <div style="text-align: center; font-size: 13px; padding: 2px;">
            <p style="margin: 0 0 8px 0;">Les coordonnées du point (${lat}, ${lon}) ont été copiées.</p>
            <button onclick="this.closest('.leaflet-popup').remove();" 
                    style="padding: 3px 10px; cursor: pointer; border-radius: 4px; border: 1px solid #ccc; background-color: #f4f4f4;">
                Fermer
            </button>
        </div>
    `;

    // 2. Attacher le popup en désactivant la croix par défaut (closeButton: false)
    pt.bindPopup(popupContent, {
        closeButton: false,
        offset: [0, -5] // Ajuste légèrement la hauteur par rapport au point
    });

    // 3. Gestionnaire d'événement au clic
    pt.on('click', function(e) {
        L.DomEvent.stopPropagation(e);
        const coordsStr = `${lat},${lon}`;
        copierDansPressePapier(coordsStr);
        
        // Ouvre le popup automatiquement sur le point cliqué
        pt.openPopup();
    });

    pt.addTo(parentGroup);
    return pt;
}




/* ---------------- CRÉATION DU BLOC D'OUTILS SUR LA CARTE ---------------- */

// Définition d'un contrôle personnalisé positionné en haut à gauche ('topleft')
const OutilsCartoControl = L.Control.extend({
    options: {
        position: 'topleft'
    },
    onAdd: function (map) {
        // Création du conteneur principal 
        const container = L.DomUtil.create('div', 'block-carte-outils');
        
        // Styles CSS 
        container.style.background = 'white';
        container.style.padding = '6px';
        container.style.borderRadius = '4px';
        container.style.boxShadow = '0 1px 5px rgba(0,0,0,0.4)';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '5px';
        container.style.alignItems = 'center';
        container.style.minWidth = '90px';
        container.style.marginLeft = '10px'; // Décale le bloc à droite du bouton zoom

        // Injection de la structure HTML exacte (Boutons + Mini-bornes)
        
				
		
		container.innerHTML = `
            <div style="display: flex; gap: 5px; width: 100%;">
                <button id="btnReset" style="flex: 1; height: 28px; padding: 0 8px; background-color: #f44336; color: white; cursor: pointer; border: none; border-radius: 4px; font-weight: bold;">Reset</button>
            </div>
            
            <div style="display: flex; gap: 20px; margin-top: 4px; height: 32px;">
                <div id="btnMasquerRouge" class="borne-pr" style="position: relative; cursor: pointer; margin: 0; transform: scale(0.75); transform-origin: top center;" title="Afficher/Masquer les bornes PR rouges">
                    <div class="borne-axe"></div>
                    <div class="borne-num"></div>
                    <div id="barreRouge" style="display: none; position: absolute; top: 16px; left: -8px; width: 48px; height: 3px; background-color: #000; transform: rotate(45deg); z-index: 9999;"></div>
                </div>

                <div id="btnMasquerOrange" class="borne-pr" style="position: relative; cursor: pointer; margin: 0; transform: scale(0.75); transform-origin: top center;" title="Afficher/Masquer les bornes PR oranges">
                    <div class="borne-axe" style="background: orange !important;"></div>
                    <div class="borne-num"></div>
                    <div id="barreOrange" style="display: none; position: absolute; top: 16px; left: -8px; width: 48px; height: 3px; background-color: #000; transform: rotate(45deg); z-index: 9999;"></div>
                </div>
            </div>
			
			<div style="display: flex; gap: 12px; margin-top: 6px; align-items: center; justify-content: center;">
                <!-- Marqueur Rouge -->
                <div id="btnMasquerMarkRouge" style="position: relative; cursor: pointer; width: 20px; height: 32px;" title="Afficher/Masquer marqueurs rouges">
                    <img src="https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png" style="width: 100%; height: 100%; object-fit: contain;">
                    <div id="barreMarkRouge" style="display: none; position: absolute; top: 14px; left: -6px; width: 32px; height: 3px; background-color: #000; transform: rotate(45deg); z-index: 9999;"></div>
                </div>

                <!-- Marqueur Vert -->
                <div id="btnMasquerMarkVert" style="position: relative; cursor: pointer; width: 20px; height: 32px;" title="Afficher/Masquer marqueurs verts">
                    <img src="https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png" style="width: 100%; height: 100%; object-fit: contain;">
                    <div id="barreMarkVert" style="display: none; position: absolute; top: 14px; left: -6px; width: 32px; height: 3px; background-color: #000; transform: rotate(45deg); z-index: 9999;"></div>
                </div>

                <!-- Marqueur Bleu -->
                <div id="btnMasquerMarkBleu" style="position: relative; cursor: pointer; width: 20px; height: 32px;" title="Afficher/Masquer marqueurs bleus">
                    <img src="https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png" style="width: 100%; height: 100%; object-fit: contain;">
                    <div id="barreMarkBleu" style="display: none; position: absolute; top: 14px; left: -6px; width: 32px; height: 3px; background-color: #000; transform: rotate(45deg); z-index: 9999;"></div>
                </div>
            </div>
			
			<!-- Boutons Zoom + et Zoom - pour les icônes de la carte -->
            <div style="display: flex; gap: 8px; margin-top: 6px; align-items: center; justify-content: center; width: 100%;">
                <button id="btnZoomIconesPlus" style="flex: 1; height: 26px; border: 1px solid #ccc; background-color: #ffffff; border-radius: 4px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 13px;" title="Agrandir toutes les icônes de la carte">🔍+</button>
                <button id="btnZoomIconesMoins" style="flex: 1; height: 26px; border: 1px solid #ccc; background-color: #ffffff; border-radius: 4px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 13px;" title="Réduire toutes les icônes de la carte">🔍-</button>
            </div>
			
			
			<div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed #ccc; font-size: 12px; color: #2c3e50;">
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
        <span style="cursor: pointer; user-select: none; font-size: 14px;" id="btnToggleRRN_C" title="Masquer/Afficher RRN C">👁️</span>
        <div style="width: 25px; height: 4px; background-color: blue; border-radius: 2px;"></div>
        <span>RRN C</span>
    </div>
    <div style="display: flex; align-items: center; gap: 8px;">
        <span style="cursor: pointer; user-select: none; font-size: 14px;" id="btnToggleRRN_NC" title="Masquer/Afficher RRN NC">👁️</span>
        <div style="width: 25px; height: 4px; background-color: green; border-radius: 2px;"></div>
        <span>RRN NC</span>
    </div>
	
	<!-- GESIR C -->
    <div style="display: flex; flex-direction: column; margin-bottom: 4px;">
        <div style="display: flex; align-items: center; gap: 8px;">
            <span style="cursor: pointer; user-select: none; font-size: 14px;" id="btnToggleGESIR_C" title="Afficher GESIR C">❌</span>
            <span>GESIR C</span>
        </div>
        <div id="subOptions_GESIR_C" style="display: none; flex-direction: column; margin-left: 22px; margin-top: 4px; gap: 3px; font-size: 11px;">
            <div class="gesir-filter-item" data-layer="C" data-class="1" style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                <div style="width: 18px; height: 3px; background-color: #014701;"></div><span>1</span>
            </div>
            <div class="gesir-filter-item" data-layer="C" data-class="2" style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                <div style="width: 18px; height: 3px; background-color: #2cf52c;"></div><span>2</span>
            </div>
            <div class="gesir-filter-item" data-layer="C" data-class="3" style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                <div style="width: 18px; height: 3px; background-color: #f1c40f;"></div><span>3</span>
            </div>
            <div class="gesir-filter-item" data-layer="C" data-class="4" style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                <div style="width: 18px; height: 3px; background-color: #e67e22;"></div><span>4</span>
            </div>
            <div class="gesir-filter-item" data-layer="C" data-class="5" style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                <div style="width: 18px; height: 3px; background-color: #f50000;"></div><span>5</span>
            </div>
            <div class="gesir-filter-item" data-layer="C" data-class="ND" style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                <div style="width: 18px; height: 3px; background-color: #000000;"></div><span>ND</span>
            </div>
        </div>
    </div>

    <!-- GESIR NC -->
    <div style="display: flex; flex-direction: column;">
        <div style="display: flex; align-items: center; gap: 8px;">
            <span style="cursor: pointer; user-select: none; font-size: 14px;" id="btnToggleGESIR_NC" title="Afficher GESIR NC">❌</span>
            <span>GESIR NC</span>
        </div>
        <div id="subOptions_GESIR_NC" style="display: none; flex-direction: column; margin-left: 22px; margin-top: 4px; gap: 3px; font-size: 11px;">
            <div class="gesir-filter-item" data-layer="NC" data-class="1" style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                <div style="width: 18px; height: 3px; background-color: #014701;"></div><span>1</span>
            </div>
            <div class="gesir-filter-item" data-layer="NC" data-class="2" style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                <div style="width: 18px; height: 3px; background-color: #2cf52c;"></div><span>2</span>
            </div>
            <div class="gesir-filter-item" data-layer="NC" data-class="3" style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                <div style="width: 18px; height: 3px; background-color: #f1c40f;"></div><span>3</span>
            </div>
            <div class="gesir-filter-item" data-layer="NC" data-class="4" style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                <div style="width: 18px; height: 3px; background-color: #e67e22;"></div><span>4</span>
            </div>
            <div class="gesir-filter-item" data-layer="NC" data-class="5" style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                <div style="width: 18px; height: 3px; background-color: #f50000;"></div><span>5</span>
            </div>
            <div class="gesir-filter-item" data-layer="NC" data-class="ND" style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                <div style="width: 18px; height: 3px; background-color: #000000;"></div><span>ND</span>
            </div>
        </div>
    </div>
	
	
	
	
</div>
        `;

        // Désactiver la propagation du clic et du double-clic sur la carte quand on interagit avec le bloc
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        return container;
    }
});

// --- GESTION DU FILTRE GESTIONNAIRE (GVO) ---


/* ---------------- GESTION DU FILTRE GESTIONNAIRE (GVO) ---------------- */

function initialiserFiltreGestionnaire() {
    const subList = document.getElementById('subListGestionnaires');
    const chkTous = document.getElementById('chkGestionnaireTous');
    if (!subList || !chkTous) return;

    // Récupérer l'ensemble des GVO uniques depuis les 4 sources (identique à votre logique d'origine)
    const gvoSet = new Set();

    // 1. RRN_C et RRN_NC
    if (typeof donneesRRN_C !== 'undefined' && donneesRRN_C.objects && donneesRRN_C.objects.RRN_C) {
        const feats = topojson.feature(donneesRRN_C, donneesRRN_C.objects.RRN_C).features;
        feats.forEach(f => {
            const gvo = f.properties.gestionnai || f.properties.GVO || f.properties.gvo;
            if (gvo) gvoSet.add(String(gvo).trim());
        });
    }
    if (typeof donneesRRN_NC !== 'undefined' && donneesRRN_NC.objects && donneesRRN_NC.objects.RRN_NC) {
        const feats = topojson.feature(donneesRRN_NC, donneesRRN_NC.objects.RRN_NC).features;
        feats.forEach(f => {
            const gvo = f.properties.gestionnai || f.properties.GVO || f.properties.gvo;
            if (gvo) gvoSet.add(String(gvo).trim());
        });
    }

    // 2. GESIR C
    if (typeof donneesGESIR26_C !== 'undefined') {
        const objKey = donneesGESIR26_C.objects.GESIR26_RRN_C ? 'GESIR26_RRN_C' : Object.keys(donneesGESIR26_C.objects)[0];
        const feats = topojson.feature(donneesGESIR26_C, donneesGESIR26_C.objects[objKey]).features;
        feats.forEach(f => {
            const gvo = f.properties.GVO || f.properties.gvo;
            if (gvo) gvoSet.add(String(gvo).trim());
        });
    }

    // 3. GESIR NC
    if (typeof donneesGESIR26_NC !== 'undefined') {
        const objKey = donneesGESIR26_NC.objects.GESIR26_RRN_C ? 'GESIR26_RRN_C' : Object.keys(donneesGESIR26_NC.objects)[0];
        const feats = topojson.feature(donneesGESIR26_NC, donneesGESIR26_NC.objects[objKey]).features;
        feats.forEach(f => {
            const gvo = f.properties.GVO || f.properties.gvo;
            if (gvo) gvoSet.add(String(gvo).trim());
        });
    }

    gvoDisponiblesGlobal = Array.from(gvoSet).sort((a, b) => 
        a.localeCompare(b, 'fr', { sensitivity: 'base' })
    );

    // Remplissage dynamique des cases à cocher
    subList.innerHTML = '';
    gvoDisponiblesGlobal.forEach(gvo => {
        const label = document.createElement('label');
        label.style.cssText = 'display: flex; align-items: center; gap: 6px; cursor: pointer; font-weight: normal;';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = gvo;
        checkbox.className = 'chk-gvo-item';

        // Événement sur chaque case de gestionnaire
        checkbox.addEventListener('change', function() {
            if (this.checked) {
                chkTous.checked = false; // Décoche "Tous" si on coche un gestionnaire
            } else {
                // S'il ne reste plus aucune case cochée, on recoche "Tous" par défaut
                const resteCoche = subList.querySelectorAll('.chk-gvo-item:checked');
                if (resteCoche.length === 0) {
                    chkTous.checked = true;
                }
            }
            gererChangementGestionnaires();
        });

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(gvo));
        subList.appendChild(label);
    });

    // Événement sur la case "Tous"
    chkTous.addEventListener('change', function() {
        if (this.checked) {
            subList.querySelectorAll('.chk-gvo-item').forEach(chk => chk.checked = false);
        }
        gererChangementGestionnaires();
    });
}

function gererChangementGestionnaires() {
    mettreAJourCouleurFondFiltre();
    mettreAJourTitreGestionnaire();
    rafraichirToutesLesCouchesRoutieres();
}

function mettreAJourCouleurFondFiltre() {
    const container = document.getElementById('containerGestionnaires');
    const chkTous = document.getElementById('chkGestionnaireTous');
    if (!container || !chkTous) return;
    
    // Vert (#2ecc71) si "Tous" est coché, Orange (#e67e22) sinon
    container.style.backgroundColor = chkTous.checked ? '#2ecc71' : '#e67e22';
}

function mettreAJourTitreGestionnaire() {
    const titreGestionnaire = document.getElementById('titreGestionnaire');
    const chkTous = document.getElementById('chkGestionnaireTous');
    const subList = document.getElementById('subListGestionnaires');
    if (!titreGestionnaire || !chkTous || !subList) return;

    const cochees = subList.querySelectorAll('.chk-gvo-item:checked');
    let texteTitre = "Gestionnaires";

    if (!chkTous.checked && cochees.length > 0) {
        const nb = cochees.length;
        if (nb === 1) {
            texteTitre = "Gestionnaire (1)";
        } else {
            texteTitre = `Gestionnaires (${nb})`;
        }
    }
    
    titreGestionnaire.innerHTML = `<b>${texteTitre}</b>`;
}

function getGvoSelectionnes() {
    const chkTous = document.getElementById('chkGestionnaireTous');
    const subList = document.getElementById('subListGestionnaires');
    if (!chkTous || !subList || chkTous.checked) return null; // null signifie "Tous"

    const cochees = subList.querySelectorAll('.chk-gvo-item:checked');
    return Array.from(cochees).map(chk => chk.value);
}

function featurePasseFiltreGestionnaire(feature) {
    const gvoSelectionnes = getGvoSelectionnes();
    if (!gvoSelectionnes) return true; // "Tous" est sélectionné

    const props = feature.properties || {};
    const gvoFeature = String(props.gestionnai || props.GVO || props.gvo || '').trim();
    return gvoSelectionnes.includes(gvoFeature);
}


// Ajout du bloc d'outils sur la carte
map.addControl(new OutilsCartoControl());
      

// Écouteurs pour masquer/afficher les bornes et leurs points exacts correspondants
document.body.addEventListener('click', function(e) {
    const btnRouge = e.target.closest('#btnMasquerRouge');
    if (btnRouge) {
        bornesBlanchesMasquees = !bornesBlanchesMasquees;
        const barre = document.getElementById('barreRouge');
        if (barre) barre.style.display = bornesBlanchesMasquees ? 'block' : 'none';
        
        prMarkers.forEach(m => {
            if (bornesBlanchesMasquees) map.removeLayer(m);
            else m.addTo(map);
        });

        if (bornesBlanchesMasquees) {
            containerPointsTous.removeLayer(containerPointsBlancs);
        } else {
            containerPointsTous.addLayer(containerPointsBlancs);
        }
    }

    const btnOrange = e.target.closest('#btnMasquerOrange');
    if (btnOrange) {
        bornesOrangesMasquees = !bornesOrangesMasquees;
        const barre = document.getElementById('barreOrange');
        if (barre) barre.style.display = bornesOrangesMasquees ? 'block' : 'none';

        clicMarkers.forEach(m => {
            if (bornesOrangesMasquees) map.removeLayer(m);
            else m.addTo(map);
        });

        if (bornesOrangesMasquees) {
            containerPointsTous.removeLayer(containerPointsRouges);
        } else {
            containerPointsTous.addLayer(containerPointsRouges);
        }
    }
	
	const btnMasquerMarkRouge = e.target.closest('#btnMasquerMarkRouge');
	if (btnMasquerMarkRouge) {
		MarkRougeMasque = !MarkRougeMasque;
	const barreMarkRouge = document.getElementById('barreMarkRouge');
    if (barreMarkRouge) barreMarkRouge.style.display = MarkRougeMasque ? 'block' : 'none';

        clicMarkers.forEach(m => {
            if (MarkRougeMasque) map.removeLayer(m);
            else m.addTo(map);
        });
	}
	
	
	const btnMasquerMarkVert = e.target.closest('#btnMasquerMarkVert');
	if (btnMasquerMarkVert) {
		MarkVertMasque = !MarkVertMasque;
	const barreMarkVert = document.getElementById('barreMarkVert');
    if (barreMarkVert) barreMarkVert.style.display = MarkVertMasque ? 'block' : 'none';

        clicMarkers.forEach(m => {
            if (MarkVertMasque) map.removeLayer(m);
            else m.addTo(map);
        });
	}
	
	const btnMasquerMarkBleu = e.target.closest('#btnMasquerMarkBleu');
	if (btnMasquerMarkBleu) {
		MarkBleuMasque = !MarkBleuMasque;
	const barreMarkBleu = document.getElementById('barreMarkBleu');
    if (barreMarkBleu) barreMarkBleu.style.display = MarkBleuMasque ? 'block' : 'none';
        blueMarkers.forEach(m => {
            if (MarkBleuMasque) map.removeLayer(m);
            else m.addTo(map);
        });
        clicMarkers.forEach(m => {
            if (MarkBleuMasque) map.removeLayer(m);
            else m.addTo(map);
        });
	}
	
	// Clic sur Zoom + (augmente la taille de 15%)
    const btnZoomPlus = e.target.closest('#btnZoomIconesPlus');
    if (btnZoomPlus) {
        facteurZoomIcones += 0.15;
        actualiserTailleIcones();
    }

    // Clic sur Zoom - (réduit la taille de 15%, min 0.3)
    const btnZoomMoins = e.target.closest('#btnZoomIconesMoins');
    if (btnZoomMoins) {
        facteurZoomIcones = Math.max(0.3, facteurZoomIcones - 0.15);
        actualiserTailleIcones();
    }
	
	
	
});







/* ---------------- CHARGEMENT DYNAMIQUE DES FICHIERS ---------------- */

function injecterScript(url, callback, onerror) {
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = url;
    script.charset = 'utf-8';
    
    script.onload = () => {
        if (callback) callback();
        if (script.parentNode) script.parentNode.removeChild(script);
    };
    
    script.onerror = () => {
        if (script.parentNode) script.parentNode.removeChild(script);
        if (onerror) onerror();
    };
    
    (document.head || document.body).appendChild(script);
}

function chargerFichierAxe(axe, callback) {
    const axeId = axe.toLowerCase().trim();
    const axeBrut = axe.trim();
    
    if (axesCharges[axeId]) {
        if (callback) callback(axesCharges[axeId]);
        return;
    }

    const nomVariable = `donnees_${axeId}`;
    
    if (window[nomVariable]) {
        const donneesFormatees = window[nomVariable].map(p => [
            p.axe, Number(p.PR), Number(p.abscisse), Number(p.latitude), Number(p.longitude), p.gvo || ''
        ]);
        axesCharges[axeId] = donneesFormatees;
        if (callback) callback(donneesFormatees);
        return;
    }

    // Teste les minuscules ET les majuscules
    const cheminsPossibles = [
        `FICHIERS/AXES/${axeId}.js`,
        `FICHIERS/AXES/${axeBrut}.js`,
        `./FICHIERS/AXES/${axeId}.js`,
        `./FICHIERS/AXES/${axeBrut}.js`
    ];

    function tenterFetch(index) {
        if (index >= cheminsPossibles.length) {
            alert(`Le fichier de données pour l'axe ${axe} est introuvable dans le package www/FICHIERS/AXES/.`);
            return;
        }

        fetch(cheminsPossibles[index])
            .then(response => {
                if (!response.ok) throw new Error("Fichier non trouvé");
                return response.text();
            })
            .then(codeScript => {
                // Evaluation du script
                window.eval(codeScript);

                const donneesRaw = window[nomVariable];
                if (donneesRaw) {
                    const donneesFormatees = donneesRaw.map(p => [
                        p.axe, Number(p.PR), Number(p.abscisse), Number(p.latitude), Number(p.longitude), p.gvo || ''
                    ]);
                    axesCharges[axeId] = donneesFormatees;
                    if (callback) callback(donneesFormatees);
                } else {
                    alert(`Variable ${nomVariable} non trouvée dans ${cheminsPossibles[index]}`);
                }
            })
            .catch(() => {
                tenterFetch(index + 1);
            });
    }

    tenterFetch(0);
}

/* ---------------- CLIC SUR LA CARTE & RECHERCHE DE PR LE PLUS PROCHE ---------------- */

function distance2(lat1, lon1, lat2, lon2) {
    return Math.pow(lat1 - lat2, 2) + Math.pow(lon1 - lon2, 2);
}



function BtnNettoyerCarte() {
    facteurZoomIcones = 1;
    actualiserTailleIcones();
    
    if (routeLine) map.removeLayer(routeLine);
    if (markerStart) map.removeLayer(markerStart);
    if (markerEnd) map.removeLayer(markerEnd);
    if (MarkRond) map.removeLayer(MarkRond);
    
    prMarkers.forEach(m => map.removeLayer(m));
    prMarkers = [];

    clicMarkers.forEach(m => map.removeLayer(m));
    clicMarkers = [];

    // --- SUPPRESSION DES MARQUEURS BLEUS AU RESET ---
    blueMarkers.forEach(m => map.removeLayer(m));
    blueMarkers = [];
    // -----------------------------------------------
    
    containerPointsTous.clearLayers();
    containerPointsBlancs.clearLayers();
    containerPointsRouges.clearLayers();
    
    containerPointsTous.addLayer(containerPointsBlancs);
    containerPointsTous.addLayer(containerPointsRouges);
}
	
	

	
function nettoyerCarte() {
    // 1. Suppression des éléments de tracés et repères d'itinéraires
    BtnNettoyerCarte();
	facteurZoomIcones = 1;
        actualiserTailleIcones();
    // 3. Nettoyage et décochage des couches d'Aires
    if (coucheAiresC) map.removeLayer(coucheAiresC);
    if (coucheAiresNC) map.removeLayer(coucheAiresNC);
    if (document.getElementById('chkAiresC')) document.getElementById('chkAiresC').checked = false;
    if (document.getElementById('chkAiresNC')) document.getElementById('chkAiresNC').checked = false;
	
	if (coucheAiresC_A) map.removeLayer(coucheAiresC_A);
    if (coucheAiresNC_A) map.removeLayer(coucheAiresNC_A);
    if (document.getElementById('chkAiresC_Autre')) document.getElementById('chkAiresC_Autre').checked = false;
    if (document.getElementById('chkAiresNC_Autre')) document.getElementById('chkAiresNC_Autre').checked = false;
	
	if (coucheAiresC_S) map.removeLayer(coucheAiresC_S);
    if (coucheAiresNC_S) map.removeLayer(coucheAiresNC_S);
    if (document.getElementById('chkAiresC_S')) document.getElementById('chkAiresC_S').checked = false;
    if (document.getElementById('chkAiresNC_S')) document.getElementById('chkAiresNC_S').checked = false;
	
	if (coucheAiresC_R) map.removeLayer(coucheAiresC_R);
    if (coucheAiresNC_R) map.removeLayer(coucheAiresNC_R);
    if (document.getElementById('chkAiresC_R')) document.getElementById('chkAiresC_R').checked = false;
    if (document.getElementById('chkAiresNC_R')) document.getElementById('chkAiresNC_R').checked = false;
	

    // 4. Nettoyage et décochage des Péages (Pleine voie et Échangeur)
    if (couchePeages) map.removeLayer(couchePeages);
    if (document.getElementById('chkPeagesBPV')) document.getElementById('chkPeagesBPV').checked = false;
    if (document.getElementById('chkPeagesEch')) document.getElementById('chkPeagesEch').checked = false;
	
	// 4b. Nettoyage et décochage des  Échangeurs
    if (coucheEchangeurs) map.removeLayer(coucheEchangeurs);
    if (document.getElementById('chkEch_Bifurcation')) document.getElementById('chkEch_Bifurcation').checked = false;
    if (document.getElementById('chkEch_Diffuseur')) document.getElementById('chkEch_Diffuseur').checked = false;
	 if (document.getElementById('chkEch_Mixte')) document.getElementById('chkEch_Mixte').checked = false;
	
	
	//QUALICHARGE
	const chkAfficher_Aires_C = document.getElementById('chkAfficher_Aires_C');
    if (chkAfficher_Aires_C) chkAfficher_Aires_C.checked = false;

    const legendeAireC = document.getElementById('legende_Qualicharge_AireC');
    if (legendeAireC) legendeAireC.style.display = 'none';
	
	const chkAfficher_Aires_NC = document.getElementById('chkAfficher_Aires_NC');
    if (chkAfficher_Aires_NC) chkAfficher_Aires_NC.checked = false;

    const legendeAireNC = document.getElementById('legende_Qualicharge_AireNC');
    if (legendeAireNC) legendeAireNC.style.display = 'none';
	

    // 5. Nettoyage visuel de la couche Carrefours
    if (coucheCarrefours) {
        map.removeLayer(coucheCarrefours);
        coucheCarrefours.clearLayers();
    }
    
    const chkFiltrerCarrefours = document.getElementById('chkFiltrerCarrefours');
    if (chkFiltrerCarrefours) chkFiltrerCarrefours.checked = false;

    const legendeCarrefours = document.getElementById('legende_Qualicharge_Carrefour');
    if (legendeCarrefours) legendeCarrefours.style.display = 'none';
	
	
	

    // 6. SUPPRESSION PHYSIQUE DES POPUPS MODALES DU DOM (ÉCRAN)
    const modalAires = document.getElementById("modal_resultats_aires");
    if (modalAires) modalAires.remove();

    const modalCarrefours = document.getElementById("modal_resultats_carrefours");
    if (modalCarrefours) modalCarrefours.remove();

    // 7. Rafraîchissement global de la légende générale si nécessaire
    if (typeof rafraichirAffichageLegende === 'function') {
        rafraichirAffichageLegende();
    }
}
window.definirPoint = function(type, axe, pr, abs) {
    const axeSelect = document.getElementById(`axe${type}`);
    if (axeSelect) axeSelect.value = axe;
    
    remplirPrEtAbs(axe, type, () => {
        const prSelect = document.getElementById(`pr${type}`);
        const absSelect = document.getElementById(`abs${type}`);
        if (prSelect) prSelect.value = pr;
        
        const donneesAxe = axesCharges[axe.toLowerCase()];
        if (donneesAxe && absSelect) {
            remplirAbscisses(donneesAxe, pr, absSelect);
            absSelect.value = abs;
        }
    });
    map.closePopup();
};

// Fonction globale pour enlever un marqueur orange spécifique de la carte
window.supprimerMarqueurOrange = function(popupId) {
    if (window.clicMarkers) {
        const index = window.clicMarkers.findIndex(m => m._leaflet_id === popupId);
        if (index !== -1) {
            const m = window.clicMarkers[index];
            if (m._linkedPoint) containerPointsRouges.removeLayer(m._linkedPoint);
            map.removeLayer(m);
            window.clicMarkers.splice(index, 1);
        }
    }
};

// Fonction globale pour afficher le PR entier précédent et suivant avec zoom automatique
window.afficherPrAdjacents = function(axe, prActuel, absActuel) {
    chargerFichierAxe(axe, function(donneesAxe) {
        // Filtrer uniquement les points de type PR entier (abscisse === 0)
        let prEntiers = donneesAxe.filter(p => p[2] === 0);
        
        // Si aucun PR entier pur à 0 n'existe, on prend les premiers points de chaque PR
        if (prEntiers.length === 0) {
            const prsUniques = [...new Set(donneesAxe.map(p => p[1]))];
            prsUniques.forEach(prNum => {
                const premierPt = donneesAxe.find(p => p[1] === prNum);
                if (premierPt) prEntiers.push(premierPt);
            });
        }
        
        // Tri par ordre logique croissant de position
        prEntiers.sort((a, b) => a[1] - b[1] || a[2] - b[2]);

        // Recherche du PR précédent
        let prPrecedent = null;
        for (let i = prEntiers.length - 1; i >= 0; i--) {
            if (prEntiers[i][1] < prActuel || (prEntiers[i][1] === prActuel && prEntiers[i][2] < absActuel)) {
                prPrecedent = prEntiers[i];
                break;
            }
        }
        if (!prPrecedent && prEntiers.length > 0) prPrecedent = prEntiers[0];

        // Recherche du PR suivant
        let prSuivant = null;
        for (let i = 0; i < prEntiers.length; i++) {
            if (prEntiers[i][1] > prActuel || (prEntiers[i][1] === prActuel && prEntiers[i][2] > absActuel)) {
                prSuivant = prEntiers[i];
                break;
            }
        }
        if (!prSuivant && prEntiers.length > 0) prSuivant = prEntiers[prEntiers.length - 1];

        // Affichage visuel des bornes sur la carte
        if (prPrecedent) window.creerBorneVisuelleStandard(prPrecedent);
        if (prSuivant) window.creerBorneVisuelleStandard(prSuivant);
        
        // ZOOM AUTOMATIQUE AJUSTÉ SUR LES DEUX PR TROUVÉS
        if (prPrecedent && prSuivant) {
            const limites = L.latLngBounds([
                [prPrecedent[3], prPrecedent[4]],
                [prSuivant[3], prSuivant[4]]
            ]);
            map.fitBounds(limites, { padding: [50, 50] });
        } else if (prPrecedent || prSuivant) {
            
            const ptUnique = prPrecedent || prSuivant;
            map.setView([ptUnique[3], ptUnique[4]], 15);
        }

        map.closePopup(); // Ferme la bulle d'info
    });
};
// Fonction d'aide pour générer la borne bleue/blanche (ou rouge/blanche) classique isolée
window.creerBorneVisuelleStandard = function(p) {
    const axe = p[0], pr = p[1], abs = p[2], lat = p[3], lon = p[4]; gvo = p[5]
    
    // Vérification des doublons pour éviter de superposer des bornes identiques
    const existeDeja = prMarkers.some(m => m.getLatLng().lat === lat && m.getLatLng().lng === lon);
    if (existeDeja) return;
	
	// POINT PRÉCIS (Blanc cerclé de noir)
    creerPointPrecis(lat, lon, '#ffffff', containerPointsBlancs);

    const htmlBorne = `
        <div class="borne-pr">
            <div class="borne-axe">${axe}</div>
            <div class="borne-texte" style="display: flex; align-items: center; justify-content: center; height: 20px; font-size: 11px; font-weight: bold;">${pr}</div>
        </div>
    `;
    const coordsStr = `${lat},${lon}`;
    const mBorne = L.marker([lat, lon], {
        icon: L.divIcon({ className: 'custom-div-icon borne-rouge-marker', html: htmlBorne, iconSize: [34, 42], iconAnchor: [17, 42] })
		}).addTo(map).bindPopup(`<b>Axe :</b> ${axe}<br><b>PR :</b> ${pr}+${abs}<br><br>${gvo}<br><br><a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}" target="_blank" 
       onclick="copierDansPressePapier('${coordsStr}')"
       style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/StreetView.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Street View"> StreetView</a><br><a href="https://www.google.com/maps/search/?api=1&query=${lat},${lon}&basemap=roadmap" target="_blank" 
       onclick="copierDansPressePapier('${coordsStr}')"
       style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Maps.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Maps"> Maps</a><br><a href="https://earth.google.com/web/@${lat},${lon},100a,350d,35y,0h,0t,0r" target="_blank" 
       onclick="copierDansPressePapier('${coordsStr}')"
       style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Earth.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Earth"> Earth</a>`);
   
    prMarkers.push(mBorne);
	actualiserTailleIcones();
};

/* ---------------- GESTION DES LISTES DÉROULANTES ---------------- */

function initAxeSelects() {
    injecterScript('./FICHIERS/AXES/index_axes.js', () => {
        const indexAxes = window.INDEX_AXES || [];

        // Map pour conserver l'axe unique et sa couleur associée
        const axesMap = new Map();
        indexAxes.forEach(item => {
            if (!axesMap.has(item.axe)) {
                axesMap.set(item.axe, item.couleur);
            }
        });

        // Tri alphabétique/numérique des axes
        const axesTries = Array.from(axesMap.keys()).sort((a, b) => 
            a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' })
        );

        const axeDep = document.getElementById("axeDep");
        const axeArr = document.getElementById("axeArr");
        
        if (!axeDep || !axeArr) return;
        
        axeDep.innerHTML = "";
        axeArr.innerHTML = "";

        // Remplissage avec style de couleur
        axesTries.forEach(axe => {
            const couleur = axesMap.get(axe);

            const optDep = new Option(axe, axe);
            if (couleur) optDep.style.color = couleur;
           // optDep.style.fontWeight = 'bold';
            axeDep.add(optDep);

            const optArr = new Option(axe, axe);
            if (couleur) optArr.style.color = couleur;
           // optArr.style.fontWeight = 'bold';
            axeArr.add(optArr);
        });

        axeDep.addEventListener("change", function() { 
            remplirPrEtAbs(this.value, "Dep"); 
            if (axeArr) {
                axeArr.value = this.value;
                remplirPrEtAbs(this.value, "Arr");
            }
        });
        axeArr.addEventListener("change", function() { remplirPrEtAbs(this.value, "Arr"); });

        if (axesTries.length > 0) {
            remplirPrEtAbs(axesTries[0], "Dep");
            remplirPrEtAbs(axesTries[0], "Arr");
        }
    });
}

function remplirPrEtAbs(axe, type, callback) {
    chargerFichierAxe(axe, function(donneesAxe) {
        const prSelect = document.getElementById(`pr${type}`);
        const absSelect = document.getElementById(`abs${type}`);
        
        if (!prSelect || !absSelect) return;
        
        prSelect.innerHTML = "";
        absSelect.innerHTML = "";

        const prs = [...new Set(donneesAxe.map(p => p[1]))].sort((a, b) => a - b);
        prs.forEach(pr => prSelect.add(new Option(pr, pr)));

        prSelect.onchange = function() {
            remplirAbscisses(donneesAxe, Number(this.value), absSelect);
        };

        if (prs.length > 0) {
            remplirAbscisses(donneesAxe, prs[0], absSelect);
        }
        if (callback) callback();
    });
}

function remplirAbscisses(donneesAxe, prSelectionne, absSelect) {
    absSelect.innerHTML = "";
    const abscisses = donneesAxe
        .filter(p => p[1] === prSelectionne)
        .map(p => p[2])
        .sort((a, b) => a - b);

    abscisses.forEach(abs => absSelect.add(new Option(abs, abs)));
}

/* ---------------- LOGIQUE DE TRACÉ ET ACTIONS PRINCIPALES ---------------- */
// itinéraire

document.getElementById("btn").addEventListener("click", function() {
    const axeDep = document.getElementById("axeDep").value;
    const prDep = Number(document.getElementById("prDep").value);
    const absDep = Number(document.getElementById("absDep").value);

    const axeArr = document.getElementById("axeArr").value;
    const prArr = Number(document.getElementById("prArr").value);
    const absArr = Number(document.getElementById("absArr").value);

    BtnNettoyerCarte();

    const greenIcon = new L.Icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
		className: 'MarkerVert'
    });
    const redIcon = new L.Icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
		className: 'MarkerRouge'
    });

    function vientAvant(p1_PR, p1_abs, p2_PR, p2_abs) {
        if (p1_PR !== p2_PR) return p1_PR < p2_PR;
        return p1_abs <= p2_abs;
    }

    if (axeDep === axeArr) {
        chargerFichierAxe(axeDep, function(donneesAxe) {
            const ptDepart = donneesAxe.find(p => p[1] === prDep && p[2] === absDep);
            const ptArrivee = donneesAxe.find(p => p[1] === prArr && p[2] === absArr);

            if (!ptDepart || !ptArrivee) {
                alert("Impossible de localiser les points de repère.");
                return;
            }

            const sensCroissant = vientAvant(prDep, absDep, prArr, absArr);
            const pMin = sensCroissant ? ptDepart : ptArrivee;
            const pMax = sensCroissant ? ptArrivee : ptDepart;

            const pointsSegment = donneesAxe.filter(p => 
                vientAvant(pMin[1], pMin[2], p[1], p[2]) && vientAvant(p[1], p[2], pMax[1], pMax[2])
            );
            
            pointsSegment.sort((a, b) => a[1] - b[1] || a[2] - b[2]);
            if (!sensCroissant) pointsSegment.reverse();
            
          //  const coordsTrace = pointsSegment.map(p => [p[3], p[4]]);
          //  routeLine = L.polyline(coordsTrace, { color: 'purple', weight: 5 }).addTo(map);
			
			const troncons = [];
        let tronconCourant = [];

        for (let i = 0; i < pointsSegment.length; i++) {
            const pActuel = pointsSegment[i];
            if (i > 0) {
                const pPrecedent = pointsSegment[i - 1];
                // Si la différence de PR entre 2 points consécutifs est > 1, on interrompt la ligne
                if (Math.abs(pActuel[1] - pPrecedent[1]) > 1) {
                    if (tronconCourant.length > 0) {
                        troncons.push(tronconCourant);
                    }
                    tronconCourant = [];
                }
            }
            tronconCourant.push([pActuel[3], pActuel[4]]);
        }
        if (tronconCourant.length > 0) {
            troncons.push(tronconCourant);
        }

        routeLine = L.polyline(troncons, { color: 'purple', weight: 5 }).addTo(map);
			
			
			const coordsStrD = `${ptDepart[3]},${ptDepart[4]}`;
			const coordsStrA = `${ptArrivee[3]},${ptArrivee[4]}`;
			
			
			// CREATION DES POINTS PRÉCIS DÉPART (VERT) ET ARRIVÉE (ROUGE)
            creerPointPrecis(ptDepart[3], ptDepart[4], '#2ec4b6');
            creerPointPrecis(ptArrivee[3], ptArrivee[4], '#e74c3c');

            markerStart = L.marker([ptDepart[3], ptDepart[4]], { icon: greenIcon }).addTo(map)
                .bindPopup(`<b>Départ :</b> ${axeDep} - PR ${prDep}+${absDep}<br><br>${ptDepart[5]}<br><br><a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ptDepart[3]},${ptDepart[4]}" target="_blank" onclick="copierDansPressePapier('${coordsStrD}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/StreetView.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Street View"> StreetView</a><br><a href="https://www.google.com/maps/search/?api=1&query=${ptDepart[3]},${ptDepart[4]}&basemap=roadmap" target="_blank" onclick="copierDansPressePapier('${coordsStrD}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Maps.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Maps"> Maps</a><br><a href="https://earth.google.com/web/@${ptDepart[3]},${ptDepart[4]},100a,350d,35y,0h,0t,0r" target="_blank" onclick="copierDansPressePapier('${coordsStrD}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Earth.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Earth"> Earth</a>`);
            
            markerEnd = L.marker([ptArrivee[3], ptArrivee[4]], { icon: redIcon }).addTo(map)
                .bindPopup(`<b>Arrivée :</b> ${axeArr} - PR ${prArr}+${absArr}<br><br>${ptArrivee[5]}<br><br><a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ptArrivee[3]},${ptArrivee[4]}" target="_blank" onclick="copierDansPressePapier('${coordsStrA}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/StreetView.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Street View"> StreetView</a><br><a href="https://www.google.com/maps/search/?api=1&query=${ptArrivee[3]},${ptArrivee[4]}&basemap=roadmap" target="_blank" onclick="copierDansPressePapier('${coordsStrA}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Maps.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Maps"> Maps</a><br><a href="https://earth.google.com/web/@${ptArrivee[3]},${ptArrivee[4]},100a,350d,35y,0h,0t,0r" target="_blank" onclick="copierDansPressePapier('${coordsStrA}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Earth.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Earth"> Earth</a>`);
			
			// GESTION DES BORNES DE DÉPART ET D'ARRIVÉE (ORANGE SI ABS != 0, ROUGE SI ABS == 0)
            const ptDepartFormat = [axeDep, ptDepart[1], ptDepart[2], ptDepart[3], ptDepart[4], ptDepart[5]];
            const ptArriveeFormat = [axeArr, ptArrivee[1], ptArrivee[2], ptArrivee[3], ptArrivee[4], ptArrivee[5]];

            if (absDep !== 0) {
                afficherBorneClic(ptDepartFormat);
            } else {
                window.creerBorneVisuelleStandard(ptDepart);
            }

            if (absArr !== 0) {
                afficherBorneClic(ptArriveeFormat);
            } else {
                window.creerBorneVisuelleStandard(ptArrivee);
            }
			
            pointsSegment.forEach(p => {
                if (p[2] === 0 && !(p[1] === prDep && p[2] === absDep) && !(p[1] === prArr && p[2] === absArr)) {
                    window.creerBorneVisuelleStandard(p);
                }
				
				
            });
			actualiserTailleIcones();
            map.fitBounds(routeLine.getBounds());
        });
    } 
    else {
        chargerFichierAxe(axeDep, function(donneesAxeDep) {
            chargerFichierAxe(axeArr, function(donneesAxeArr) {
                
                const ptDepart = donneesAxeDep.find(p => p[1] === prDep && p[2] === absDep);
                const ptArrivee = donneesAxeArr.find(p => p[1] === prArr && p[2] === absArr);

                if (!ptDepart || !ptArrivee) {
                    alert("Impossible de localiser les points de repère.");
                    return;
                }

                let ptInterDep = donneesAxeDep[donneesAxeDep.length - 1];
                let ptInterArr = donneesAxeArr[0];
                let distMin = Infinity;

                donneesAxeDep.forEach(pD => {
                    donneesAxeArr.forEach(pA => {
                        const d = Math.pow(pD[3] - pA[3], 2) + Math.pow(pD[4] - pA[4], 2);
                        if (d < distMin) {
                            distMin = d;
                            ptInterDep = pD;
                            ptInterArr = pA;
                        }
                    });
                });

                const depAvantInter = vientAvant(prDep, absDep, ptInterDep[1], ptInterDep[2]);
                const pMinD = depAvantInter ? ptDepart : ptInterDep;
                const pMaxD = depAvantInter ? ptInterDep : ptDepart;

                const pointsAxeDep = donneesAxeDep.filter(p => 
                    vientAvant(pMinD[1], pMinD[2], p[1], p[2]) && vientAvant(p[1], p[2], pMaxD[1], pMaxD[2])
                );
                pointsAxeDep.sort((a, b) => a[1] - b[1] || a[2] - b[2]);
                if (!depAvantInter) pointsAxeDep.reverse();
                const coordsPortion1 = pointsAxeDep.map(p => [p[3], p[4]]);

                const interAvantArr = vientAvant(ptInterArr[1], ptInterArr[2], prArr, absArr);
                const pMinA = interAvantArr ? ptInterArr : ptArrivee;
                const pMaxA = interAvantArr ? ptArrivee : ptInterArr;

                const pointsAxeArr = donneesAxeArr.filter(p => 
                    vientAvant(pMinA[1], pMinA[2], p[1], p[2]) && vientAvant(p[1], p[2], pMaxA[1], pMaxA[2])
                );
                pointsAxeArr.sort((a, b) => a[1] - b[1] || a[2] - b[2]);
                if (!interAvantArr) pointsAxeArr.reverse();
                const coordsPortion2 = pointsAxeArr.map(p => [p[3], p[4]]);

                const urlOSRM = `https://router.project-osrm.org/route/v1/driving/${ptInterDep[4]},${ptInterDep[3]};${ptInterArr[4]},${ptInterArr[3]}?overview=full&geometries=geojson`;

                fetch(urlOSRM)
                    .then(response => response.json())
                    .then(data => {
                        let coordsJonction = [];
                        if (data.routes && data.routes.length > 0) {
                            coordsJonction = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
                        }

                        const coordsGlobales = [...coordsPortion1, ...coordsJonction, ...coordsPortion2];
                        routeLine = L.polyline(coordsGlobales, { color: 'purple', weight: 5 }).addTo(map);
						
						const coordsStrD = `${ptDepart[3]},${ptDepart[4]}`;
						const coordsStrA = `${ptArrivee[3]},${ptArrivee[4]}`;
						
						
						
						// CREATION DES POINTS PRÉCIS DÉPART (VERT) ET ARRIVÉE (ROUGE)
            creerPointPrecis(ptDepart[3], ptDepart[4], '#2ec4b6');
            creerPointPrecis(ptArrivee[3], ptArrivee[4], '#e74c3c');

                        markerStart = L.marker([ptDepart[3], ptDepart[4]], { icon: greenIcon }).addTo(map)
                            .bindPopup(`<b>Départ :</b> ${axeDep} - PR ${prDep}+${absDep}<br><br>${ptDepart[5]}<br><br><a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ptDepart[3]},${ptDepart[4]}" target="_blank" onclick="copierDansPressePapier('${coordsStrD}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/StreetView.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Street View"> StreetView</a><br><a href="https://www.google.com/maps/search/?api=1&query=${ptDepart[3]},${ptDepart[4]}&basemap=roadmap" target="_blank" onclick="copierDansPressePapier('${coordsStrD}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Maps.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Maps"> Maps</a><br><a href="https://earth.google.com/web/@${ptDepart[3]},${ptDepart[4]},100a,350d,35y,0h,0t,0r" target="_blank" onclick="copierDansPressePapier('${coordsStrD}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Earth.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Earth"> Earth</a>`);

                        
                        markerEnd = L.marker([ptArrivee[3], ptArrivee[4]], { icon: redIcon }).addTo(map)
                            .bindPopup(`<b>Arrivée :</b> ${axeArr} - PR ${prArr}+${absArr}<br><br>${ptArrivee[5]}<br><br><a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ptArrivee[3]},${ptArrivee[4]}" target="_blank" onclick="copierDansPressePapier('${coordsStrA}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/StreetView.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Street View"> StreetView</a><br><a href="https://www.google.com/maps/search/?api=1&query=${ptArrivee[3]},${ptArrivee[4]}&basemap=roadmap" target="_blank" onclick="copierDansPressePapier('${coordsStrA}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Maps.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Maps"> Maps</a><br><a href="https://earth.google.com/web/@${ptArrivee[3]},${ptArrivee[4]},100a,350d,35y,0h,0t,0r" target="_blank" onclick="copierDansPressePapier('${coordsStrA}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Earth.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Earth"> Earth</a>`);

                        // GESTION DES BORNES DE DÉPART ET D'ARRIVÉE (ORANGE SI ABS != 0, ROUGE SI ABS == 0)
                        const ptDepartFormat = [axeDep, ptDepart[1], ptDepart[2], ptDepart[3], ptDepart[4], ptDepart[5]];
                        const ptArriveeFormat = [axeArr, ptArrivee[1], ptArrivee[2], ptArrivee[3], ptArrivee[4], ptArrivee[5]];

                        if (absDep !== 0) {
                            afficherBorneClic(ptDepartFormat);
                        } else {
                            window.creerBorneVisuelleStandard(ptDepart);
                        }

                        if (absArr !== 0) {
                            afficherBorneClic(ptArriveeFormat);
                        } else {
                            window.creerBorneVisuelleStandard(ptArrivee);
                        }
						
						
						
						const toutesLesBornes = [...pointsAxeDep, ...pointsAxeArr];
                        toutesLesBornes.forEach(p => {
                            if (p[2] === 0 && !(p[1] === prDep && p[0] === axeDep) && !(p[1] === prArr && p[0] === axeArr)) {
                                window.creerBorneVisuelleStandard(p);
                            }
							
                        });
						actualiserTailleIcones();
                        map.fitBounds(routeLine.getBounds());
                    })
                    .catch(err => {
                        console.error(err);
                        const coordsGlobales = [...coordsPortion1, ...coordsPortion2];
                        routeLine = L.polyline(coordsGlobales, { color: 'purple', weight: 5 }).addTo(map);
                        map.fitBounds(routeLine.getBounds());
                    });
            });
        });
    }
});

/* ---------------- ÉCOUTEUR DE CLIC SUR LA CARTE ---------------- */

// Fonction mathématique pour calculer la distance minimale entre un point (clic) et un segment [A, B]
function distancePointSegment(latC, lonC, latA, lonA, latB, lonB) {
    const x = lonC, y = latC;
    const x1 = lonA, y1 = latA;
    const x2 = lonB, y2 = latB;

    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const len_sq = C * C + D * D;
    let param = -1;
    if (len_sq !== 0) param = dot / len_sq;

    let xx, yy;

    if (param < 0) {
        xx = x1;
        yy = y1;
    } else if (param > 1) {
        xx = x2;
        yy = y2;
    } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
    }

    const dx = x - xx;
    const dy = y - yy;
    return dx * dx + dy * dy; // Renvoie la distance au carré
}


map.on('click', function(e) {
    if (e.originalEvent.target.classList.contains('leaflet-marker-icon') || 
        e.originalEvent.target.closest('.borne-pr')) {
        return; 
    }

    const latClic = e.latlng.lat;
    const lonClic = e.latlng.lng;

    injecterScript('FICHIERS/AXES/index_axes.js', () => {
        const indexAxes = window.INDEX_AXES || [];
        if (indexAxes.length === 0) return;

        // Regroupement des points de l'index par axe pour reconstituer les segments
        const axesSegments = {};
        indexAxes.forEach(p => {
            if (!axesSegments[p.axe]) axesSegments[p.axe] = [];
            axesSegments[p.axe].push(p);
        });

        // Calcul de la distance du clic par rapport aux tracés globaux de chaque axe
        const listeAxesCalculés = [];
        for (const nomAxe in axesSegments) {
            const pts = axesSegments[nomAxe];
            let minDistAxe = Infinity;

            if (pts.length === 1) {
                // Si l'axe n'a qu'un point, calcul classique point à point
                minDistAxe = distance2(latClic, lonClic, pts[0].latitude, pts[0].longitude);
            } else {
                // Si l'axe a plusieurs points, on teste la distance par rapport à chaque segment consecutif
                for (let i = 0; i < pts.length - 1; i++) {
                    const dSeg = distancePointSegment(latClic, lonClic, pts[i].latitude, pts[i].longitude, pts[i+1].latitude, pts[i+1].longitude);
                    if (dSeg < minDistAxe) minDistAxe = dSeg;
                }
            }
            listeAxesCalculés.push({ axe: nomAxe, dist: minDistAxe });
        }

        // Tri des axes : les lignes d'axes les plus proches du clic ressortent en premier
        listeAxesCalculés.sort((a, b) => a.dist - b.dist);

        // On retient suffisamment d'axes candidats pour couvrir les réseaux étendus
        const axesCandidats = listeAxesCalculés.slice(0, 15).map(item => item.axe);

        if (axesCandidats.length === 0) return;

        // Recherche finale dans les fichiers réels détaillés des axes retenus
        let meilleurPointGlobal = null;
        let distMinGlobal = Infinity;

        function chercherDansAxes(index) {
            if (index >= axesCandidats.length) {
                if (meilleurPointGlobal) {
                    afficherBorneClic(meilleurPointGlobal);
                }
                return;
            }

            const axeCourant = axesCandidats[index];
            chargerFichierAxe(axeCourant, (donneesAxe) => {
                donneesAxe.forEach(p => {
                    const d = distance2(latClic, lonClic, p[3], p[4]);
                    if (d < distMinGlobal) {
                        distMinGlobal = d;
                        meilleurPointGlobal = p;
                    }
                });
                chercherDansAxes(index + 1);
            });
        }

        chercherDansAxes(0);
    });
});
// Fonction isolée pour générer proprement le marqueur orange au clic
function afficherBorneClic(meilleurPoint) {
    const axe = meilleurPoint[0];
    const pr = meilleurPoint[1];
    const abs = meilleurPoint[2];
    const lat = meilleurPoint[3];
    const lon = meilleurPoint[4];
    const gvo = meilleurPoint[5];

    const lat2 = lat.toFixed(6);
    const lon2 = lon.toFixed(6);
    let gpsText = "";
    let gpsLink = "";
    gpsText = ` - ${lat2}, ${lon2}`;
    gpsLink = `<br><a href="https://www.google.com/maps/search/?api=1&query=${lat},${lon}&basemap=roadmap" target="_blank" style="color: #3498db; font-size: 12px; text-decoration: none;">📍 Voir sur la carte</a>`;


	
if (typeof isRecording !== 'undefined' && isRecording) {
        const maintenantClic = new Date();
        const jour = String(maintenantClic.getDate()).padStart(2, '0');
        const mois = String(maintenantClic.getMonth() + 1).padStart(2, '0');
        const annee = maintenantClic.getFullYear();
        const heures = String(maintenantClic.getHours()).padStart(2, '0');
        const minutes = String(maintenantClic.getMinutes()).padStart(2, '0');
        const secondes = String(maintenantClic.getSeconds()).padStart(2, '0');
        const numEvent = ++rapportIndexEvent;
        currentFileContent += `
    <div class="entry">
        <b>${numEvent} - [Point cliqué - ${heures}h${minutes}m${secondes}s${gpsText}]</b>${gpsLink}<br>
        Axe : ${axe}, GVO : ${gvo}, PR : ${pr}+${abs}<br><br>
    </div>
`;
        //currentFileContent += `- ${heures}h${minutes}m${secondes}s - Point cliqué : ${lat2},${lon2} - Axe : ${axe}, GVO : ${gvo}, PR : ${pr}+${abs}<br><br>`;
    }

	// POINT PRÉCIS BORNE ORANGE (Orange cerclé de noir)
    const ptOrange = creerPointPrecis(lat, lon, '#ff9800', containerPointsRouges);

    // Affichage épuré avec des tailles réduites pour éviter tout chevauchement ou troncature
    const htmlBorneClic = `
        <div class="borne-pr" style="border-color: #ff9800; height: 42px;">
            <div class="borne-axe" style="background-color: #ff9800;">${axe}</div>
            <div class="borne-texte" style="display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.0; padding: 1px 0; height: 22px; box-sizing: border-box;">
                <span style="font-size: 9px; font-weight: bold; color: #333; margin-bottom: 1px;">${pr}</span>
                <span style="font-size: 8px; font-weight: normal; color: #666;">+ ${abs}</span>
            </div>
        </div>
    `;

    // Création du marqueur orange
    const nouveauMarqueurOrange = L.marker([lat, lon], {
        icon: L.divIcon({ 
            className: 'custom-div-icon borne-orange-marker', 
            html: htmlBorneClic, 
            iconSize: [34, 42], 
            iconAnchor: [17, 42] 
        })
    });

    nouveauMarqueurOrange._linkedPoint = ptOrange;

    if (!bornesOrangesMasquees) {
        nouveauMarqueurOrange.addTo(map);
    }

    if (typeof actualiserTailleIcones === 'function') actualiserTailleIcones();

    // 1. Création du conteneur HTML de la popup
    const conteneurPopup = document.createElement('div');
    conteneurPopup.style.textAlign = 'center';
    conteneurPopup.style.minWidth = '165px';
    conteneurPopup.style.position = 'relative';
    conteneurPopup.style.paddingTop = '5px';

    // 2. Création physique du bouton Sens Interdit (⛔)
    const boutonSuppr = document.createElement('span');
    boutonSuppr.innerText = '⛔';
    boutonSuppr.title = 'Enlever de la carte';
    boutonSuppr.style.position = 'absolute';
    boutonSuppr.style.top = '-7px';
    boutonSuppr.style.left = '-2px';
    boutonSuppr.style.fontSize = '14px';
    boutonSuppr.style.cursor = 'pointer';
    boutonSuppr.style.userSelect = 'none';
    boutonSuppr.style.padding = '2px 5px';
    boutonSuppr.style.zIndex = '9999';

    // 3. ÉCOUTEUR RADICAL : On utilise la référence directe de l'objet et du tableau global
    boutonSuppr.addEventListener('click', function(e) {
        // Bloque le comportement par défaut de Leaflet
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }
        
        // Ferme la popup active sur la carte
        map.closePopup();
		if (ptOrange) containerPointsRouges.removeLayer(ptOrange);
        map.removeLayer(nouveauMarqueurOrange);
        
        
        
        // Nettoie proprement le tableau global de suivi
        if (window.clicMarkers) {
            window.clicMarkers = window.clicMarkers.filter(m => m !== nouveauMarqueurOrange);
        }
    });

    // 4. Contenu textuel et autres boutons
    const resteContenu = document.createElement('div');
	const coordsStr = `${lat},${lon}`;
    resteContenu.innerHTML = `
        <b>${axe} - PR ${pr}+${abs}</b><br><br>${gvo}<br><br>
        <button onclick="definirPoint('Dep', '${axe}', ${pr}, ${abs}); map.closePopup();">Définir comme Départ</button><br><br>
        <button onclick="definirPoint('Arr', '${axe}', ${pr}, ${abs}); map.closePopup();">Définir comme Arrivée</button><br><br>
        <button onclick="afficherPrAdjacents('${axe}', ${pr}, ${abs})" style="background-color: #555; color: white; border: none; border-radius: 4px; padding: 5px 10px; font-weight: bold; cursor: pointer; margin-bottom: 10px; width: 90%;">PR Adjacents</button><br>
        <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/StreetView.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Street View"> StreetView</a><br><a href="https://www.google.com/maps/search/?api=1&query=${lat},${lon}&basemap=roadmap" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Maps.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Maps"> Maps</a><br><a href="https://earth.google.com/web/@${lat},${lon},100a,350d,35y,0h,0t,0r" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Earth.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Earth"> Earth</a>
    `;

    // 5. Assemblage final
    conteneurPopup.appendChild(boutonSuppr);
    conteneurPopup.appendChild(resteContenu);

    // Association de l'élément à la popup
    nouveauMarqueurOrange.bindPopup(conteneurPopup);
    
    // Sauvegarde dans le tableau global
    clicMarkers.push(nouveauMarqueurOrange);
}
/* ---------------- GESTION DE L'AFFICHAGE COUCHES AIRES & PÉAGES ---------------- */
 // Fonction interne de conversion Lambert 93 vers WGS84 (Lat/Lon)
    function lambert93ToWGS84(x, y) {
        const c = 11754255.426; // constante de projection
        const x0 = 700000.0;
        const y0 = 12655612.049;
        const n = 0.725607765053267;
        const e = 0.0818191910428158; // excentricité première
        const e2 = e * e;

        const dx = x - x0;
        const dy = y - y0;
        const r = Math.sqrt(dx * dx + dy * dy);
        const gamma = Math.atan(dx / -dy);

        const latIso = -1 / n * Math.log(Math.abs(r / c));
        
        // Calcul de la latitude par itérations successives
        let phi = 2 * Math.atan(Math.exp(latIso)) - Math.PI / 2;
        let phiPrecedent = 0;
        let p = 0;
        
        while (Math.abs(phi - phiPrecedent) > 1e-11 && p < 100) {
            phiPrecedent = phi;
            const sinPhi = Math.sin(phi);
            const esinPhi = e * sinPhi;
            phi = 2 * Math.atan(Math.pow((1 + esinPhi) / (1 - esinPhi), e / 2) * Math.exp(latIso)) - Math.PI / 2;
            p++;
        }

        const lon = (gamma / n) * (180 / Math.PI) + 3; // +3 pour le méridien de Paris en Lambert93
        const lat = phi * (180 / Math.PI);

        return { lat: lat, lon: lon };
    }
function creerCouchePeages(donnees) {
    const groupeMarqueurs = L.featureGroup();
    const geojsonData = donnees && donnees.features ? donnees : window.donnees_Peages;

    if (!geojsonData) return groupeMarqueurs;

   

    L.geoJSON(geojsonData, {
        pointToLayer: function(feature, latlng) {
            const props = feature.properties;
            const coords = feature.geometry.coordinates;

            let lat, lon;

            // Détection automatique : si la coordonnée X est supérieure à 180, c'est du Lambert 93
            if (Math.abs(coords[0]) > 180) {
                const conversion = lambert93ToWGS84(coords[0], coords[1]);
                lat = conversion.lat;
                lon = conversion.lon;
            } else {
                // Déjà en WGS84 (degrés)
                lat = coords[1];
                lon = coords[0];
            }

            const positionWGS84 = L.latLng(lat, lon);
			const coordsStr = `${lat},${lon}`;

            const lienStreetView = `<a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/StreetView.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Street View"> StreetView</a><br><a href="https://www.google.com/maps/search/?api=1&query=${lat},${lon}&basemap=roadmap" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Maps.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Maps"> Maps</a><br><a href="https://earth.google.com/web/@${lat},${lon},100a,350d,35y,0h,0t,0r" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Earth.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Earth"> Earth</a>`;

      const nomGare = props.nomGare || 'Sans nom';
            const typeGare = props.typeGare_l || '';
            const sectionn = props.sectionn_1 || '';
            const axe = props.axe || props.Axe || 'Axe inconnu';
            const cote = props.cote || 'Inconnu';

            // Contenu initial
            const textePopupInitial = `
                <div style="text-align: left; font-family: Arial, sans-serif;">
                    <b>${axe}</b> - Côté : ${cote}<br><br>
                    <b>${nomGare}</b> (${typeGare})<br>
                    <br>${sectionn}<br><br>
                    ${lienStreetView}
                </div>
            `;

            const iconePeageBPV = L.icon({
    iconUrl: 'FICHIERS/peage_bpv.png', 
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -10]
});

const iconePeageEchangeur = L.icon({
    iconUrl: 'FICHIERS/peage_echangeur.png', 
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -10]
});

        // Sélection dynamique de l'icône selon le type de gare renseigné
let iconeSelectionnee = iconePeageBPV; // Par défaut Pleine voie
const typeMinuscule = typeGare.toLowerCase();

if (typeMinuscule.includes("echangeur") || typeMinuscule.includes("échangeur")) {
    iconeSelectionnee = iconePeageEchangeur;
}

            // Génération du marqueur avec la bonne icône
            const marqueurPeage = L.marker(positionWGS84, { icon: iconeSelectionnee }).bindPopup(textePopupInitial);

            // Écouteur dynamique au clic (Calcul asynchrone du PR+Abs le plus proche) - INCHANGÉ
            marqueurPeage.on('popupopen', function(e) {
                const popup = e.popup;

                chargerFichierAxe(axe, (donneesAxe) => {
                    let meilleurPoint = null;
                    let affinementDistMin = Infinity;

                    donneesAxe.forEach(p => {
                        const d = distance2(lat, lon, p[3], p[4]);
                        if (d < affinementDistMin) {
                            affinementDistMin = d;
                            meilleurPoint = p;
                        }
                    });

                    if (meilleurPoint) {
                        const pr = meilleurPoint[1];
                        const abs = meilleurPoint[2];

                        const textePopupMisAJour = `
                            <div style="text-align: left; font-family: Arial, sans-serif;">
                                <b>${axe} - PR ${pr}+${abs}</b> - Côté : ${cote}<br><br>
                                <b>${nomGare}</b> (${typeGare})<br>
                                <br>${sectionn}<br><br>
                                ${lienStreetView}
                            </div>
                        `;
                        popup.setContent(textePopupMisAJour);
                    }
                });
            });

            return marqueurPeage;
        }
    }).eachLayer(function(layer) {
        groupeMarqueurs.addLayer(layer);
    });

    return groupeMarqueurs;
}
/* ---------------- GESTION DES BOUTONS "RESET" ET "VOIR UN POINT" ---------------- */

document.getElementById("btnReset").addEventListener("click", function() {
    nettoyerCarte();

    if (searchMarker) {
        map.removeLayer(searchMarker);
        searchMarker = null;
    }

// Réinitialisation des couches RRN et GESIR
    if (map.hasLayer(coucheGESIR_C)) map.removeLayer(coucheGESIR_C);
    if (map.hasLayer(coucheGESIR_NC)) map.removeLayer(coucheGESIR_NC);
    if (typeof coucheRRN_C !== 'undefined' && !map.hasLayer(coucheRRN_C)) coucheRRN_C.addTo(map);
    if (typeof coucheRRN_NC !== 'undefined' && !map.hasLayer(coucheRRN_NC)) coucheRRN_NC.addTo(map);

    // Réinitialisation des boutons visuels RRN / GESIR dans la barre d'outils
    const btnToggleRRN_C = document.getElementById('btnToggleRRN_C');
    if (btnToggleRRN_C) { btnToggleRRN_C.textContent = "👁️"; btnToggleRRN_C.title = "Masquer RRN C"; }
    const btnToggleRRN_NC = document.getElementById('btnToggleRRN_NC');
    if (btnToggleRRN_NC) { btnToggleRRN_NC.textContent = "👁️"; btnToggleRRN_NC.title = "Masquer RRN NC"; }

    const btnGESIR_C = document.getElementById('btnToggleGESIR_C');
    if (btnGESIR_C) { btnGESIR_C.textContent = "❌"; btnGESIR_C.title = "Afficher GESIR C"; }
    const btnGESIR_NC = document.getElementById('btnToggleGESIR_NC');
    if (btnGESIR_NC) { btnGESIR_NC.textContent = "❌"; btnGESIR_NC.title = "Afficher GESIR NC"; }

    const subOptsC = document.getElementById('subOptions_GESIR_C');
    if (subOptsC) subOptsC.style.display = 'none';
    const subOptsNC = document.getElementById('subOptions_GESIR_NC');
    if (subOptsNC) subOptsNC.style.display = 'none';

    if (typeof gesirC_classesMasquees !== 'undefined') gesirC_classesMasquees.clear();
    if (typeof gesirNC_classesMasquees !== 'undefined') gesirNC_classesMasquees.clear();

    document.querySelectorAll('.gesir-filter-item').forEach(item => {
        const traitDiv = item.querySelector('div');
        if (traitDiv) traitDiv.style.opacity = '1';
        const croix = item.querySelector('.croix-rouge');
        if (croix) croix.remove();
    });


if (map.hasLayer(coucheStationsAires)) map.removeLayer(coucheStationsAires);
if (map.hasLayer(routeLine)) map.removeLayer(routeLine);
coucheStationsAires.clearLayers();
const chkFiltrerAiresHTML = document.getElementById('chkFiltrerStationsAires');
if (chkFiltrerAiresHTML) chkFiltrerAiresHTML.checked = false;

// Force la disparition du bloc de légende Aires au Reset
    //const legendeAires = document.getElementById('legende_Qualicharge_Aires');
   // if (legendeAires) legendeAires.style.display = 'none';
const legendeCrf = document.getElementById('legende_Qualicharge_Carrefour');
    if (legendeCrf) legendeCrf.style.display = 'none';
const wlVL = document.getElementById('wrapper_Qualicharge_VL');
const wlPL = document.getElementById('wrapper_Qualicharge_PL');
const wlAiresC = document.getElementById('wrapper_Aires_C');
const wlAiresNC = document.getElementById('wrapper_Aires_NC');

if (wlVL) wlVL.style.display = 'inline-block';
if (wlPL) wlPL.style.display = 'inline-block';
if (wlAiresC) wlAiresC.style.display = 'none';
if (wlAiresNC) wlAiresNC.style.display = 'none';

const legAireC = document.getElementById('legende_Qualicharge_AireC');
			const legAireNC = document.getElementById('legende_Qualicharge_AireNC');
			
			if (legAireC) legAireC.style.display =  'none';
			if (legAireNC) legAireNC.style.display = 'none';


    const inputRech = document.getElementById('inputRecherche');
    if (inputRech) inputRech.value = '';

    const listesDeroulantes = ["axeDep", "prDep", "absDep", "axeArr", "prArr", "absArr"];
    listesDeroulantes.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.selectedIndex = 0;
    });

    if (document.getElementById("axeDep")) document.getElementById("axeDep").dispatchEvent(new Event('change'));
    if (document.getElementById("axeArr")) document.getElementById("axeArr").dispatchEvent(new Event('change'));
	
	// Réinitialisation forcée et propre de la liste déroulante du gestionnaire
    const chkTousGvo = document.getElementById('chkGestionnaireTous');
const subListGvo = document.getElementById('subListGestionnaires');

if (chkTousGvo && subListGvo) {
    // 1. Cocher la case "Tous"
    chkTousGvo.checked = true;
    
    // 2. Décocher toutes les sous-cases individuelles
    subListGvo.querySelectorAll('.chk-gvo-item').forEach(chk => {
        chk.checked = false;
    });
    
    // 3. Forcer la mise à jour visuelle et le rafraîchissement des couches
    gererChangementGestionnaires();

    if (typeof mettreAJourCouleurFondFiltre === 'function') {
        mettreAJourCouleurFondFiltre();
    }
    if (typeof mettreAJourTitreGestionnaire === 'function') {
        mettreAJourTitreGestionnaire();
    }
}

        // Gestion du Cadastre lors du Reset
        const chkCadastre = document.getElementById('chkCadastre');
        if (chkCadastre) {
            chkCadastre.checked = false; // Décocher la case
        }
        
        // Supprimer la couche du cadastre si elle est active
        if (coucheCadastre && map.hasLayer(coucheCadastre)) {
            map.removeLayer(coucheCadastre);
        }
        
        // Supprimer le contour de parcelle sélectionnée si existant
        if (contourParcelleSelectionnee) {
            map.removeLayer(contourParcelleSelectionnee);
            contourParcelleSelectionnee = null;
        }

        // Fermer les éventuelles popups ouvertes sur la carte
        map.closePopup();


    map.setView([46.5, 2], 6);

        
    
	if (typeof rafraichirAffichageLegende === 'function') {
        rafraichirAffichageLegende();
    }

    if (typeof rafraichirToutesLesCouchesRoutieres === 'function') {
        rafraichirToutesLesCouchesRoutieres();
    }


    

});

document.getElementById("btnVoirDep").addEventListener("click", function() {
    const axeDep = document.getElementById("axeDep").value;
    const prDep = Number(document.getElementById("prDep").value);
    const absDep = Number(document.getElementById("absDep").value);

    BtnNettoyerCarte();

    if (searchMarker) {
        map.removeLayer(searchMarker);
        searchMarker = null;
    }

    const greenIcon = new L.Icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
		className: 'MarkerVert'
    });

    chargerFichierAxe(axeDep, function(donneesAxe) {
        const ptDepart = donneesAxe.find(p => p[1] === prDep && p[2] === absDep);

        if (!ptDepart) {
            alert("Impossible de localiser ce point de repère.");
            return;
        }

        const lat = ptDepart[3];
        const lon = ptDepart[4];
        const gvoText = ptDepart[5];
		const coordsStr = `${lat},${lon}`;

        // POINT PRÉCIS VERT POUR "VOIR UN POINT"
        creerPointPrecis(lat, lon, '#2ec4b6');

        const contenuPopup = `<b>Point repéré :</b> ${axeDep} - PR ${prDep}+${absDep}<br><br>${gvoText}<br><br><a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/StreetView.png" style="height: 16px; width: auto; vertical-align: middle;" alt="StreetView"> Street View</a><br><a href="https://www.google.com/maps/search/?api=1&query=${lat},${lon}&basemap=roadmap" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Maps.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Maps"> Maps</a><br><a href="https://earth.google.com/web/@${lat},${lon},100a,350d,35y,0h,0t,0r" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Earth.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Earth"> Earth</a>`;

        markerStart = L.marker([lat, lon], { icon: greenIcon }).addTo(map)
            .bindPopup(contenuPopup);
		
		// GESTION DE LA BORNE(ORANGE SI ABS != 0, ROUGE SI ABS == 0)
                        const ptDepartFormat = [axeDep, ptDepart[1], ptDepart[2], ptDepart[3], ptDepart[4], ptDepart[5]];


                        if (absDep !== 0) {
                            afficherBorneClic(ptDepartFormat);
                        } else {
                            window.creerBorneVisuelleStandard(ptDepart);
                        }

                       
		
		
		
        map.setView([lat, lon], 16);
        markerStart.openPopup();
        if (typeof actualiserTailleIcones === 'function') actualiserTailleIcones();
    });
});

document.getElementById("btnVoirAxe").addEventListener("click", function() {
    const axeDep = document.getElementById("axeDep").value;

    BtnNettoyerCarte();


    if (searchMarker) {
        map.removeLayer(searchMarker);
        searchMarker = null;
    }

    const greenIcon = new L.Icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
		className: 'MarkerVert'
    });
    const redIcon = new L.Icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
		className: 'MarkerRouge'
    });

    chargerFichierAxe(axeDep, function(donneesAxe) {
        if (!donneesAxe || donneesAxe.length === 0) {
            alert("Impossible de charger les données de cet axe.");
            return;
        }

        // Tri complet par ordre logique de l'axe (PR puis Abscisse)
        donneesAxe.sort((a, b) => a[1] - b[1] || a[2] - b[2]);

        const ptDepart = donneesAxe[0];
        const ptArrivee = donneesAxe[donneesAxe.length - 1];
		// 1. REMPLISSAGE AUTOMATIQUE DES MENUS DÉROULANTS
       const elemPrDep = document.getElementById("prDep");
        const elemAbsDep = document.getElementById("absDep");
        const elemPrArr = document.getElementById("prArr");
        const elemAbsArr = document.getElementById("absArr");

        // Départ
        if (elemPrDep) {
            elemPrDep.value = ptDepart[1];
            elemPrDep.dispatchEvent(new Event('change')); // Force la mise à jour des options d'abscisses si liée
        }
        if (elemAbsDep) elemAbsDep.value = ptDepart[2];

        // Arrivée
        if (elemPrArr) {
            elemPrArr.value = ptArrivee[1];
            elemPrArr.dispatchEvent(new Event('change')); // Force la mise à jour des options d'abscisses d'arrivée pour ce PR
        }
        if (elemAbsArr) elemAbsArr.value = ptArrivee[2];
		
        // Tracé de la ligne complète de l'axe
        //const coordsTrace = donneesAxe.map(p => [p[3], p[4]]);
        //routeLine = L.polyline(coordsTrace, { color: 'purple', weight: 5 }).addTo(map);
		const troncons = [];
        let tronconCourant = [];

        for (let i = 0; i < donneesAxe.length; i++) {
            const pActuel = donneesAxe[i];
            if (i > 0) {
                const pPrecedent = donneesAxe[i - 1];
                // Si la différence de PR est supérieure à 1, rupture du tracé
                if (Math.abs(pActuel[1] - pPrecedent[1]) > 1) {
                    if (tronconCourant.length > 0) {
                        troncons.push(tronconCourant);
                    }
                    tronconCourant = [];
                }
            }
            tronconCourant.push([pActuel[3], pActuel[4]]);
        }
        if (tronconCourant.length > 0) {
            troncons.push(tronconCourant);
        }

        routeLine = L.polyline(troncons, { color: 'purple', weight: 5 }).addTo(map);
		const coordsStrD = `${ptDepart[3]},${ptDepart[4]}`;
		const coordsStrA = `${ptArrivee[3]},${ptArrivee[4]}`;
		
		
		
		
		
		// CREATION DES POINTS PRÉCIS ORIGINE (VERT) ET FIN (ROUGE)
        creerPointPrecis(ptDepart[3], ptDepart[4], '#2ec4b6');
        creerPointPrecis(ptArrivee[3], ptArrivee[4], '#e74c3c');


		
        // Marqueur de début d'axe (Vert)
        markerStart = L.marker([ptDepart[3], ptDepart[4]], { icon: greenIcon }).addTo(map)
            .bindPopup(`<b>${axeDep} - Origine</b><br>PR ${ptDepart[1]}+${ptDepart[2]}<br><br>${ptDepart[5]}<br><br><a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ptDepart[3]},${ptDepart[4]}" target="_blank" onclick="copierDansPressePapier('${coordsStrD}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/StreetView.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Street View"> StreetView</a><br><a href="https://www.google.com/maps/search/?api=1&query=${ptDepart[3]},${ptDepart[4]}&basemap=roadmap" target="_blank" onclick="copierDansPressePapier('${coordsStrD}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Maps.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Maps"> Maps</a><br><a href="https://earth.google.com/web/@${ptDepart[3]},${ptDepart[4]},100a,350d,35y,0h,0t,0r" target="_blank" onclick="copierDansPressePapier('${coordsStrD}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Earth.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Earth"> Earth</a>`);
        
        // Marqueur de fin d'axe (Rouge)
        markerEnd = L.marker([ptArrivee[3], ptArrivee[4]], { icon: redIcon }).addTo(map)
            .bindPopup(`<b>${axeDep} - Fin</b><br>PR ${ptArrivee[1]}+${ptArrivee[2]}<br><br>${ptArrivee[5]}<br><br><a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ptArrivee[3]},${ptArrivee[4]}" target="_blank" onclick="copierDansPressePapier('${coordsStrA}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/StreetView.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Street View"> StreetView</a><br><a href="https://www.google.com/maps/search/?api=1&query=${ptArrivee[3]},${ptArrivee[4]}&basemap=roadmap" target="_blank" onclick="copierDansPressePapier('${coordsStrA}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Maps.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Maps"> Maps</a><br><a href="https://earth.google.com/web/@${ptArrivee[3]},${ptArrivee[4]},100a,350d,35y,0h,0t,0r" target="_blank" onclick="copierDansPressePapier('${coordsStrA}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Earth.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Earth"> Earth</a>`);
		
		
		// 2. AJOUT DES BORNES D'EXTRÉMITÉ (ORANGE SI ABS != 0, ROUGE SI ABS == 0)
       const ptDepartFormat = [axeDep, ptDepart[1], ptDepart[2], ptDepart[3], ptDepart[4], ptDepart[5]];
        const ptArriveeFormat = [axeDep, ptArrivee[1], ptArrivee[2], ptArrivee[3], ptArrivee[4], ptArrivee[5]];

        if (ptDepart[2] !== 0) {
            afficherBorneClic(ptDepartFormat);
        } else {
            window.creerBorneVisuelleStandard(ptDepart);
        }

        if (ptArrivee[2] !== 0) {
            afficherBorneClic(ptArriveeFormat);
        } else {
            window.creerBorneVisuelleStandard(ptArrivee);
        }
		
        // Affichage optionnel des bornes kilométriques intermédiaires (PR entiers)
        donneesAxe.forEach(p => {
            if (p[2] === 0 && !(p[1] === ptDepart[1] && p[2] === ptDepart[2]) && !(p[1] === ptArrivee[1] && p[2] === ptArrivee[2])) {
                window.creerBorneVisuelleStandard(p);
            }
			
        });
		map.fitBounds(routeLine.getBounds());

		// On attend que la carte ait fini d'ajuster la vue/zoom avant d'actualiser les tailles
		map.once('moveend', function() {
			actualiserTailleIcones();
		});
    });
});

  


// Fonction pour copier le texte dans le presse-papier
function copierDansPressePapier(texte) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(texte).catch(err => {
            console.error('Erreur lors de la copie :', err);
        });
    } else {
        // Alternative de secours pour les environnements non sécurisés (http)
        const textArea = document.createElement("textarea");
        textArea.value = texte;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
        } catch (err) {
            console.error('Erreur lors de la copie :', err);
        }
        document.body.removeChild(textArea);
    }
}

/* ---------------- CODE COMPLET DE LA BARRE DE RECHERCHE MIXTE ---------------- */
const inputRech = document.getElementById('inputRecherche');
const btnAller = document.getElementById('btnAller');
const divSuggestions = document.getElementById('suggestionsRecherche');

// Déclencheur lors du clic sur le bouton "Aller"
if (btnAller) {
    btnAller.addEventListener('click', function() {
        const saisieUtilisateur = inputRech.value.trim();
        // Si ce sont des coordonnées GPS, la fonction s'occupe de déplacer la carte
        verifierEtAllerAuxCoordonnees(saisieUtilisateur);
    });
}

// Optionnel : Déclencheur lorsque l'on appuie sur la touche "Entrée" dans le champ de recherche
if (inputRech) {
    inputRech.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            const saisieUtilisateur = inputRech.value.trim();
            verifierEtAllerAuxCoordonnees(saisieUtilisateur);
        }
    });
}

// Permet d'analyser si le texte entré contient des coordonnées GPS 
function verifierEtAllerAuxCoordonnees(texte) {
    const regexGPS = /^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?)\s*([,;]\s*)\s*[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$/;
    if (regexGPS.test(texte.trim())) {
        const parts = texte.trim().split(/[,;]/);
        const lat = parseFloat(parts[0]);
        const lon = parseFloat(parts[1]);
        if (!isNaN(lat) && !isNaN(lon)) {
            executerRechercheLieu(lat, lon);
            return true;
        }
    }
    return false;
}


function optimiserRequeteAxe(texte) {
    let t = texte.trim();
    if (/^[aA]\s*\d+$/.test(t)) return `autoroute A${t.match(/\d+/)[0]}`;
    if (/^([nN]|[rR][nN])\s*\d+$/.test(t)) return `route nationale ${t.match(/\d+/)[0]}`;
    if (/^([dD]|[rR][dD])\s*\d+$/.test(t)) return `route départementale ${t.match(/\d+/)[0]}`;
    return t;
}

// Fonction pour scanner en tâche de fond les fichiers locaux d'Aires (Polygones) et de Péages (Points)
function obtenirSuggestionsLocales(texte) {
    const resultats = [];
    if (!texte) return resultats;

    // Normalisation du texte saisi : passage en minuscules et suppression des accents
    const tNormalise = texte
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();

    // Fonction interne pour extraire le premier point valide [lat, lon] selon la géométrie
    function extrairePosition(geometry) {
        if (!geometry || !geometry.coordinates) return null;
        const type = geometry.type;
        const coords = geometry.coordinates;

        // Cas des Péages (Points standards : [lon, lat])
        if (type === "Point") {
            return { lat: parseFloat(coords[1]), lon: parseFloat(coords[0]) };
        } 
        
        // Cas des Aires (Polygones simples)
        if (type === "Polygon") {
            if (coords[0] && coords[0][0]) {
                return { lat: parseFloat(coords[0][0][1]), lon: parseFloat(coords[0][0][0]) };
            }
        } 
        
        // Cas des Aires complexes (MultiPolygones)
        if (type === "MultiPolygon") {
            if (coords[0] && coords[0][0] && coords[0][0][0]) {
                return { lat: parseFloat(coords[0][0][0][1]), lon: parseFloat(coords[0][0][0][0]) };
            }
        }
        
        return null;
    }

   // 1. Recherche dans les Aires Concessionnées (Aires_C - Polygones)
    if (window.window.donnees_Aires_C && window.window.donnees_Aires_C.features) {
        window.window.donnees_Aires_C.features.forEach(f => {
            const props = f.properties;
            const nom = props.NomUsuel || props.nomusuel || props.Nom || '';
            const axe = props.Axe || props.axee || '';
            
            // Normalisation du nom de l'aire pour la comparaison
            const nomNormalise = nom
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "");

            if (nomNormalise.includes(tNormalise)) {
                const pos = extrairePosition(f.geometry);
                if (pos && !isNaN(pos.lat) && !isNaN(pos.lon)) {
                    resultats.push({
                        fulltext: `[Aire C] ${nom} (${axe})`,
                        lat: pos.lat,
                        lon: pos.lon
                    });
                }
            }
        });
    }

    // 2. Recherche dans les Aires Non Concessionnées (Aires_NC - Polygones)
    if (window.window.donnees_Aires_NC && window.window.donnees_Aires_NC.features) {
        window.window.donnees_Aires_NC.features.forEach(f => {
            const props = f.properties;
            const nom = props.NomUsuel || props.nomusuel || props.Nom || '';
            const axe = props.Axe || props.axee || '';
            
            // Normalisation du nom de l'aire pour la comparaison
            const nomNormalise = nom
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "");

            if (nomNormalise.includes(tNormalise)) {
                const pos = extrairePosition(f.geometry);
                if (pos && !isNaN(pos.lat) && !isNaN(pos.lon)) {
                    resultats.push({
                        fulltext: `[Aire NC] ${nom} (${axe})`,
                        lat: pos.lat,
                        lon: pos.lon
                    });
                }
            }
        });
    }

    // 3. Recherche dans les Péages (Peages - Points)
    const dePeages = window.donnees_Peages || (window.donnees_Peages && window.donnees_Peages.features ? window.donnees_Peages : null);
    if (dePeages && dePeages.features) {
        dePeages.features.forEach(f => {
            const props = f.properties;
            const nom = props.nomGare || '';
            const axe = props.Axe || '';
            
            // Normalisation du nom du péage pour la comparaison
            const nomNormalise = nom
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "");

            if (nomNormalise.includes(tNormalise)) {
                const pos = extrairePosition(f.geometry);
                if (pos && !isNaN(pos.lat) && !isNaN(pos.lon)) {
					const coordsConverties = lambert93ToWGS84(pos.lon, pos.lat);
                    resultats.push({
                        fulltext: `[Péage] ${nom} ${axe ? '('+axe+')' : ''}`,
                        lat: coordsConverties.lat,
                        lon: coordsConverties.lon
                    });
                }
            }
        });
    }

    return resultats;
}

inputRech.addEventListener('input', function() {
    clearTimeout(searchTimer); 
    const saisieUtilisateur = inputRech.value.trim();
    const longueurMinimale = /\d/.test(saisieUtilisateur) ? 2 : 3;



	if (verifierEtAllerAuxCoordonnees(saisieUtilisateur)) return ;

    if (saisieUtilisateur.length < longueurMinimale) {
        divSuggestions.style.display = 'none';
        return;
    }

    searchTimer = setTimeout(() => {
        // Extraction immédiate des correspondances locales (Aires et Péages)
        const suggestionsLocales = obtenirSuggestionsLocales(saisieUtilisateur);

        // Limitation stricte à 15 éléments maximum 
        const localLimite = suggestionsLocales.slice(0, 15);

        const requeteOptimisee = optimiserRequeteAxe(saisieUtilisateur);
        // Utilisation de l'API de complétion officielle de la Géoplateforme IGN (max 15 réponses demandées)
        const urlIGN = `https://data.geopf.fr/geocodage/completion/?text=${encodeURIComponent(requeteOptimisee)}&maximumResponses=15`;

        fetch(urlIGN)
            .then(response => response.json())
            .then(data => {
                divSuggestions.innerHTML = '';
                
                const suggestionsIGN = data.results || [];
                
                // Fusion ordonnée : les 15 locaux max d'abord, puis les 15 IGN max en dessous
                const toutesSuggestions = [
                    ...localLimite.map(s => ({ ...s, source: 'local' })),
                    ...suggestionsIGN.map(s => ({ fulltext: `📍 ${s.fulltext}`, lat: parseFloat(s.y), lon: parseFloat(s.x), source: 'ign' }))
                ];

                if (toutesSuggestions.length === 0) {
                    divSuggestions.style.display = 'none';
                    return;
                }

                // Rendu visuel dans le conteneur HTML
                toutesSuggestions.forEach(lieu => {
                    const item = document.createElement('div');
                    item.style.padding = '8px 12px';
                    item.style.cursor = 'pointer';
                    item.style.borderBottom = '1px solid #eee';
                    item.innerText = lieu.fulltext;

                    // Un style visuel distinct pour les données .js internes
                    if (lieu.source === 'local') {
                        item.style.fontWeight = 'bold';
                        item.style.backgroundColor = '#f5f7fa';
                        item.style.color = '#1e293b';
                    }

                    item.addEventListener('click', () => {
                        inputRech.value = lieu.fulltext;
                        divSuggestions.style.display = 'none';
                        selectedPlace = { lat: lieu.lat, lon: lieu.lon }; // Utilise la variable globale
                        executerRechercheLieu(selectedPlace.lat, selectedPlace.lon);
                    });
                    divSuggestions.appendChild(item);
                });
                divSuggestions.style.display = 'block';
            })
            .catch(err => {
                console.error("Erreur IGN, bascule sur local exclusif :", err);
                // Secours : si l'IGN est en panne ou inaccessible, on affiche la liste locale (jusqu'à 30 lignes max)
                if (suggestionsLocales.length > 0) {
                    divSuggestions.innerHTML = '';
                    suggestionsLocales.slice(0, 30).forEach(lieu => {
                        const item = document.createElement('div');
                        item.style.padding = '8px 12px';
                        item.style.cursor = 'pointer';
                        item.style.borderBottom = '1px solid #eee';
                        item.style.fontWeight = 'bold';
                        item.style.backgroundColor = '#f5f7fa';
                        item.innerText = lieu.fulltext;

                        item.addEventListener('click', () => {
                            inputRech.value = lieu.fulltext;
                            divSuggestions.style.display = 'none';
                            selectedPlace = { lat: lieu.lat, lon: lieu.lon };
                            executerRechercheLieu(selectedPlace.lat, selectedPlace.lon);
                        });
                        divSuggestions.appendChild(item);
                    });
                    divSuggestions.style.display = 'block';
                } else {
                    divSuggestions.style.display = 'none';
                }
            });
    }, 250);
});

document.addEventListener('click', function(e) {
    if (e.target !== inputRech && e.target !== divSuggestions) divSuggestions.style.display = 'none';
});

function executerRechercheLieu(latLieu, lonLieu) {
    map.setView([latLieu, lonLieu], 15);

   if (searchMarker) {
        if (searchMarker._linkedPoint) containerPointsTous.removeLayer(searchMarker._linkedPoint);
        map.removeLayer(searchMarker);
    }

    // POINT PRÉCIS RECHERCHE (BLEU)
    const ptBleu = creerPointPrecis(latLieu, lonLieu, '#007bff');
	
    const blueIconStandard = new L.Icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
		className: 'MarkerBleu'
    });

    const conteneurPopup = document.createElement('div');
    conteneurPopup.style.textAlign = 'center';
    conteneurPopup.style.minWidth = '165px';
    conteneurPopup.style.position = 'relative';
    conteneurPopup.style.paddingTop = '5px';

    const boutonSuppr = document.createElement('span');
    boutonSuppr.innerText = '⛔';
    boutonSuppr.title = 'Enlever le lieu de la carte';
    boutonSuppr.style.position = 'absolute';
    boutonSuppr.style.top = '-7px';
    boutonSuppr.style.left = '-2px';
    boutonSuppr.style.fontSize = '14px';
    boutonSuppr.style.cursor = 'pointer';
    boutonSuppr.style.userSelect = 'none';
    boutonSuppr.style.padding = '2px 5px';
    boutonSuppr.style.zIndex = '9999';

    boutonSuppr.addEventListener('click', function(e) {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }
        map.closePopup();
        if (searchMarker) {
            if (searchMarker._linkedPoint) containerPointsTous.removeLayer(searchMarker._linkedPoint);
            map.removeLayer(searchMarker);
            searchMarker = null;
        }
    });

    const resteContenu = document.createElement('div');
    resteContenu.innerHTML = `<b>Lieu recherché</b><br>Lat: ${latLieu.toFixed(5)}, Lon: ${lonLieu.toFixed(5)}`;

    conteneurPopup.appendChild(boutonSuppr);
    conteneurPopup.appendChild(resteContenu);

    searchMarker = L.marker([latLieu, lonLieu], {icon: blueIconStandard}).addTo(map)
        .bindPopup(conteneurPopup);

    searchMarker._linkedPoint = ptBleu;
	searchMarker.openPopup();

    injecterScript('./FICHIERS/AXES/index_axes.js', () => {
        const indexAxes = window.INDEX_AXES || [];
        if (indexAxes.length === 0) return;

        const pointsTries = indexAxes
            .map(p => ({ ...p, dist: distance2(latLieu, lonLieu, p.latitude, p.longitude) }))
            .sort((a, b) => a.dist - b.dist);

        const axesCandidats = [...new Set(pointsTries.map(p => p.axe))].slice(0, 3);
        if (axesCandidats.length === 0) return;

        let meilleurPointGlobal = null;
        let distMinGlobal = Infinity;

        function chercherDansAxes(index) {
            if (index >= axesCandidats.length) {
                if (meilleurPointGlobal) {
                    afficherBorneClic(meilleurPointGlobal);
                }
                return;
            }

            const axeCourant = axesCandidats[index];
            chargerFichierAxe(axeCourant, (donneesAxe) => {
                donneesAxe.forEach(p => {
                    const d = distance2(latLieu, lonLieu, p[3], p[4]);
                    if (d < distMinGlobal) {
                        distMinGlobal = d;
                        meilleurPointGlobal = p;
                    }
                });
                
                chercherDansAxes(index + 1);
            });
        }

        chercherDansAxes(0);
    });
}

//gestion des Aires

function creerCoucheGeoJSON(donnees, filtreNature = null) {
    const groupeMarqueurs = L.featureGroup();

    L.geoJSON(donnees, {
        // Filtrage dynamique selon la nature transmise ('S', 'R', ou 'AUTRE')
        filter: function(feature) {
            if (!filtreNature) return true; // Si pas de filtre, on prend tout (ex: Aires NC)

            const n = (feature.properties.Nature || feature.properties.nature || '').toUpperCase();
            if (filtreNature === 'S') return n === 'S';
            if (filtreNature === 'R') return n === 'R';
            if (filtreNature === 'AUTRE') return n !== 'S' && n !== 'R';
            return true;
        },

        pointToLayer: function() { return null; },
        style: function() { return { stroke: false, fill: false, opacity: 0, fillOpacity: 0 }; },

        onEachFeature: function(feature, layer) {
            const props = feature.properties;

            let centre = null;
            if (layer.getBounds) {
                centre = layer.getBounds().getCenter();
            } else if (feature.geometry && feature.geometry.coordinates) {
                centre = L.latLng(feature.geometry.coordinates[1], feature.geometry.coordinates[0]);
            }

            if (!centre) return;

            const lat = centre.lat;
            const lon = centre.lng;
			const coordsStr = `${lat},${lon}`;
			
            const lienStreetView = `<a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/StreetView.png" style="height: 16px; width: auto; vertical-align: middle;" alt="StreetView"> Street View</a><br><a href="https://www.google.com/maps/search/?api=1&query=${lat},${lon}&basemap=roadmap" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Maps.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Maps"> Maps</a><br><a href="https://earth.google.com/web/@${lat},${lon},100a,350d,35y,0h,0t,0r" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Earth.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Earth"> Earth</a>`;

            const nature = props.Nature || props.nature || '';
            const axe = props.Axe || props.axee || '';

            const nomUsuel = props.NomUsuel || props.nomusuel || props.Nom || 'Sans nom';
            const gvo = props.GVO || props.gvo || '';

            // Détermination de l'icône et du libellé selon la nature de l'aire
            let iconeUrl = '';
            let libelleNature = '';

            if (nature === 'S') {
                iconeUrl = 'FICHIERS/Aire_Service.jpg';
                libelleNature = 'Aire de service';
            } else if (nature === 'R') {
                iconeUrl = 'FICHIERS/Aire_Repos.jpg';
                libelleNature = 'Aire de repos';
            } else {
                iconeUrl = 'FICHIERS/Parking.png';
                libelleNature = 'Autre aire';
            }

            const textePopupInitial = `
                <div style="text-align: left; font-family: Arial, sans-serif;">
                    <b>${axe}</b><br><br>
                    <b>${nomUsuel}</b> (${libelleNature})<br><br>
                    ${gvo}<br><br>
                    ${lienStreetView}
                </div>
            `;

            const iconeAire = L.icon({
                iconUrl: iconeUrl,
                iconSize: [26, 26],
                iconAnchor: [13, 13],
                popupAnchor: [0, -10]
            });

            const marqueurAire = L.marker(centre, { icon: iconeAire }).bindPopup(textePopupInitial);

            // Écouteur dynamique au moment du clic / ouverture de la bulle
            marqueurAire.on('popupopen', function(e) {
                const popup = e.popup;

                chargerFichierAxe(axe, (donneesAxe) => {
                    let meilleurPoint = null;
                    let affinementDistMin = Infinity;

                    donneesAxe.forEach(p => {
                        const d = distance2(lat, lon, p[3], p[4]);
                        if (d < affinementDistMin) {
                            affinementDistMin = d;
                            meilleurPoint = p;
                        }
                    });

                    if (meilleurPoint) {
                        const pr = meilleurPoint[1];
                        const abs = meilleurPoint[2];

                        const textePopupMisAJour = `
                            <div style="text-align: left; font-family: Arial, sans-serif;">
                                <b>${axe} - PR ${pr}+${abs}</b><br><br>
                                <b>${nomUsuel}</b> (${libelleNature})<br><br>
                                ${gvo}<br><br>
                                ${lienStreetView}
                            </div>
                        `;
                        popup.setContent(textePopupMisAJour);
                    }
                });
            });

            groupeMarqueurs.addLayer(marqueurAire);
        }
    });

    return groupeMarqueurs;
}


/* ---------------- ÉCOUTEURS D'ÉVÉNEMENTS DES CASES A COCHER ---------------- */

/// --- INITIALISATION ET REMPLISSAGE DES COUCHES DES AIRES D'ORIGINE ---
    
let coucheAiresC_S = null;
let coucheAiresC_R = null;
let coucheAiresC_A = null;
let coucheAiresNC_S = null;
let coucheAiresNC_R = null;
let coucheAiresNC_A = null;

function chargerEtGererAiresC() {
    const toutChargerEtAfficherAiresC = () => {
        // 1. Initialisation des 3 couches si elles n'existent pas encore
        if (!coucheAiresC_S) {
            coucheAiresC_S = creerCoucheGeoJSON(donnees_Aires_C, 'S');
        }
        if (!coucheAiresC_R) {
            coucheAiresC_R = creerCoucheGeoJSON(donnees_Aires_C, 'R');
        }
        if (!coucheAiresC_A) {
            coucheAiresC_A = creerCoucheGeoJSON(donnees_Aires_C, 'AUTRE');
        }

        // 2. Mise à jour de la présence sur la carte selon les checkboxes
        actualiserAffichageAiresC();
    };

    // Chargement asynchrone du script GeoJSON si non disponible
    if (typeof donnees_Aires_C === 'undefined') {
        injecterScript('FICHIERS/AIRES/Aires_C.js', () => {
            if (typeof donnees_Aires_C !== 'undefined') {
                toutChargerEtAfficherAiresC();
            } else {
                alert("Erreur lors de la lecture des données de Aires_C.js");
            }
        });
    } else {
        toutChargerEtAfficherAiresC();
    }
}


function chargerEtGererAiresNC() {
    const toutChargerEtAfficherAiresNC = () => {
        // 1. Initialisation des 3 couches si elles n'existent pas encore
        if (!coucheAiresNC_S) {
            coucheAiresNC_S = creerCoucheGeoJSON(donnees_Aires_NC, 'S');
        }
        if (!coucheAiresNC_R) {
            coucheAiresNC_R = creerCoucheGeoJSON(donnees_Aires_NC, 'R');
        }
        if (!coucheAiresNC_A) {
            coucheAiresNC_A = creerCoucheGeoJSON(donnees_Aires_NC, 'AUTRE');
        }

        // 2. Mise à jour de la présence sur la carte selon les checkboxes
        actualiserAffichageAiresNC();
    };

    // Chargement asynchrone du script GeoJSON si non disponible
    if (typeof donnees_Aires_NC === 'undefined') {
        injecterScript('FICHIERS/AIRES/Aires_NC.js', () => {
            if (typeof donnees_Aires_NC !== 'undefined') {
                toutChargerEtAfficherAiresNC();
            } else {
                alert("Erreur lors de la lecture des données de Aires_NC.js");
            }
        });
    } else {
        toutChargerEtAfficherAiresNC();
    }
}

// Gère l'ajout ou le retrait individuel de chaque sous-couche C sur la carte
function actualiserAffichageAiresC() {
    const chkMain = document.getElementById('chkAires');
    const chkC = document.getElementById('chkAiresC');
    const chkS = document.getElementById('chkAiresC_S');
    const chkR = document.getElementById('chkAiresC_R');
    const chkAutre = document.getElementById('chkAiresC_Autre');

    const globalActif = chkMain && chkMain.checked && chkC && chkC.checked;

    // Service (S)
    if (coucheAiresC_S) {
        if (globalActif && chkS && chkS.checked) coucheAiresC_S.addTo(map);
        else map.removeLayer(coucheAiresC_S);
    }

    // Repos (R)
    if (coucheAiresC_R) {
        if (globalActif && chkR && chkR.checked) coucheAiresC_R.addTo(map);
        else map.removeLayer(coucheAiresC_R);
    }

    // Autre
    if (coucheAiresC_A) {
        if (globalActif && chkAutre && chkAutre.checked) coucheAiresC_A.addTo(map);
        else map.removeLayer(coucheAiresC_A);
    }

    if (typeof mettreAJourLegende === 'function') mettreAJourLegende();
}

// Gère l'ajout ou le retrait individuel de chaque sous-couche NC sur la carte
function actualiserAffichageAiresNC() {
    const chkMain = document.getElementById('chkAires');
    const chkNC = document.getElementById('chkAiresNC');
    const chkNS = document.getElementById('chkAiresNC_S');
    const chkNR = document.getElementById('chkAiresNC_R');
    const chkNAutre = document.getElementById('chkAiresNC_Autre');

    const globalNActif = chkMain && chkMain.checked && chkNC && chkNC.checked;

    // Service (S)
    if (coucheAiresNC_S) {
        if (globalNActif && chkNS && chkNS.checked) coucheAiresNC_S.addTo(map);
        else map.removeLayer(coucheAiresNC_S);
    }

    // Repos (R)
    if (coucheAiresNC_R) {
        if (globalNActif && chkNR && chkNR.checked) coucheAiresNC_R.addTo(map);
        else map.removeLayer(coucheAiresNC_R);
    }

    // Autre
    if (coucheAiresNC_A) {
        if (globalNActif && chkNAutre && chkNAutre.checked) coucheAiresNC_A.addTo(map);
        else map.removeLayer(coucheAiresNC_A);
    }

    if (typeof mettreAJourLegende === 'function') mettreAJourLegende();
}


// écouteur aires

const chkAiresMain = document.getElementById('chkAires');
const chkAiresC = document.getElementById('chkAiresC');
const chkAiresNC = document.getElementById('chkAiresNC');
const divOptionsAires = document.getElementById('options_Aires');

const chkS = document.getElementById('chkAiresC_S');
const chkR = document.getElementById('chkAiresC_R');
const chkAutre = document.getElementById('chkAiresC_Autre');
const chkNS = document.getElementById('chkAiresNC_S');
const chkNR = document.getElementById('chkAiresNC_R');
const chkNAutre = document.getElementById('chkAiresNC_Autre');


if (chkAiresMain) {
    if (typeof mettreAJourLegende === 'function') mettreAJourLegende();

    // 1. Clic sur le switch principal "Afficher les Aires"
    chkAiresMain.addEventListener('change', function(e) {
        if (e.target.checked) {
            if (divOptionsAires) divOptionsAires.style.display = 'flex';

            // Cocher par défaut la mère et les sous-cases
            if (chkAiresC) chkAiresC.checked = true;
            if (chkS) chkS.checked = true;
            if (chkR) chkR.checked = true;
            if (chkAutre) chkAutre.checked = true;
            if (chkAiresNC) chkAiresNC.checked = true;
			if (chkNS) chkNS.checked = true;
            if (chkNR) chkNR.checked = true;
            if (chkNAutre) chkNAutre.checked = true
			

            // Chargement / Affichage des 3 couches C et 3 couches NC
            chargerEtGererAiresC();
			chargerEtGererAiresNC();

            

        } else {
            if (divOptionsAires) divOptionsAires.style.display = 'none';

            if (chkAiresC) chkAiresC.checked = false;
            if (chkS) chkS.checked = false;
            if (chkR) chkR.checked = false;
            if (chkAutre) chkAutre.checked = false;
            if (chkAiresNC) chkAiresNC.checked = false;
			if (chkNS) chkNS.checked = false;
            if (chkNR) chkNR.checked = false;
            if (chkNAutre) chkNAutre.checked = false;

            // Retrait des couches
            actualiserAffichageAiresC();
			actualiserAffichageAiresNC();
            
        }
    });
}

// 2. Clic sur la case maître "Aires RRN C" (Coche / Décoche tout le sous-groupe)
if (chkAiresC) {
    chkAiresC.addEventListener('change', function() {
        const etat = this.checked;
        if (chkS) chkS.checked = etat;
        if (chkR) chkR.checked = etat;
        if (chkAutre) chkAutre.checked = etat;

        
		
		if (!chkAiresC.checked) {
			if (chkAiresNC) {
					if (!chkAiresNC.checked) {
						chkAiresMain.checked = false ;
						MasquerAires ();
					}
            }
			} else {
				chkAiresMain.checked = true ;
		}; 

		actualiserAffichageAiresC();
    });
}

// 2b. Clic sur la case maître "Aires RRN NC" (Coche / Décoche tout le sous-groupe)
if (chkAiresNC) {
    chkAiresNC.addEventListener('change', function() {
        const Netat = this.checked;
        if (chkNS) chkNS.checked = Netat;
        if (chkNR) chkNR.checked = Netat;
        if (chkNAutre) chkNAutre.checked = Netat;

        
		
		if (!chkAiresNC.checked) {
			if (chkAiresC) {
					if (!chkAiresC.checked) {
						chkAiresMain.checked = false ;
						MasquerAires ();
					}
			}			
            } else {
				chkAiresMain.checked = true ;
		};		

		actualiserAffichageAiresNC();		
		});   	
}





// 3. Clics individuels sur chaque sous-case
[chkS, chkR, chkAutre].forEach(chk => {
    if (chk) {
        chk.addEventListener('change', function() {
            // Si au moins une sous-case est cochée, la case mère s'allume
            if (chkAiresC) {
                chkAiresC.checked = (chkS && chkS.checked) || (chkR && chkR.checked) || (chkAutre && chkAutre.checked);
            }
            actualiserAffichageAiresC();
        });
    }
});

[chkNS, chkNR, chkNAutre].forEach(chkN => {
    if (chkN) {
        chkN.addEventListener('change', function() {
            // Si au moins une sous-case est cochée, la case mère s'allume
            if (chkAiresNC) {
                chkAiresNC.checked = (chkNS && chkNS.checked) || (chkNR && chkNR.checked) || (chkNAutre && chkNAutre.checked);
            }
            actualiserAffichageAiresNC();
        });
    }
});

[chkS, chkR, chkAutre, chkNS, chkNR, chkNAutre].forEach(chkT => {
    if (chkT) {
        chkT.addEventListener('change', function() {
            // Si au moins une sous-case est cochée, la case mère s'allume
            if (chkAiresMain) {
                chkAiresMain.checked = (chkS && chkS.checked) || (chkR && chkR.checked) || (chkAutre && chkAutre.checked) || (chkNS && chkNS.checked) || (chkNR && chkNR.checked) || (chkNAutre && chkNAutre.checked);
            
			
			if(!chkAiresMain.checked) MasquerAires ();
			}
            actualiserAffichageAiresC();
			actualiserAffichageAiresC();
        });
    }
});

function MasquerAires () {
	const chkAiresMain = document.getElementById('chkAires');
const chkAiresC = document.getElementById('chkAiresC');
const chkAiresNC = document.getElementById('chkAiresNC');
const divOptionsAires = document.getElementById('options_Aires');

const chkS = document.getElementById('chkAiresC_S');
const chkR = document.getElementById('chkAiresC_R');
const chkAutre = document.getElementById('chkAiresC_Autre');
const chkNS = document.getElementById('chkAiresNC_S');
const chkNR = document.getElementById('chkAiresNC_R');
const chkNAutre = document.getElementById('chkAiresNC_Autre');

            if (divOptionsAires) divOptionsAires.style.display = 'none';

            if (chkAiresC) chkAiresC.checked = false;
            if (chkS) chkS.checked = false;
            if (chkR) chkR.checked = false;
            if (chkAutre) chkAutre.checked = false;
            if (chkAiresNC) chkAiresNC.checked = false;
			if (chkNS) chkNS.checked = false;
            if (chkNR) chkNR.checked = false;
            if (chkNAutre) chkNAutre.checked = false;
			if (typeof mettreAJourLegende === 'function') mettreAJourLegende();
			if (typeof rafraichirAffichageLegende === 'function') rafraichirAffichageLegende();
			
}



// Initialisation au chargement de la page
document.addEventListener("DOMContentLoaded", function() {
    calculerTotauxAires();
});

// Calcul dynamique des totaux
function calculerTotauxAires() {
    let countC_S = 0, countC_R = 0, countC_A = 0;
    let countNC_S = 0, countNC_R = 0, countNC_A = 0;

    if (typeof donnees_Aires_C !== 'undefined' && donnees_Aires_C.features) {
        donnees_Aires_C.features.forEach(f => {
            let nat = f.properties.Nature;
            if (nat === "S") countC_S++;
            else if (nat === "R") countC_R++;
            else countC_A++;
        });
    }

    if (typeof donnees_Aires_NC !== 'undefined' && donnees_Aires_NC.features) {
        donnees_Aires_NC.features.forEach(f => {
            let nat = f.properties.Nature;
            if (nat === "S") countNC_S++;
            else if (nat === "R") countNC_R++;
            else countNC_A++;
        });
    }

    let totC = countC_S + countC_R + countC_A;
    let totNC = countNC_S + countNC_R + countNC_A;
    let totGlobal = totC + totNC;

    // Mise à jour des libellés HTML avec (xx)
   // document.getElementById("totAires").innerText = "(" + totGlobal + ")";
    
    document.getElementById("totAiresC").innerText = "(" + totC + ")";
    document.getElementById("totAiresC_S").innerText = "(" + countC_S + ")";
    document.getElementById("totAiresC_R").innerText = "(" + countC_R + ")";
    document.getElementById("totAiresC_A").innerText = "(" + countC_A + ")";

    document.getElementById("totAiresNC").innerText = "(" + totNC + ")";
    document.getElementById("totAiresNC_S").innerText = "(" + countNC_S + ")";
    document.getElementById("totAiresNC_R").innerText = "(" + countNC_R + ")";
    document.getElementById("totAiresNC_A").innerText = "(" + countNC_A + ")";
}

// Nouvelle fonction mutualisée pour gérer l'affichage et le filtrage des Péages à la demande
function gererAffichagePeages() {
    const chkBPV = document.getElementById('chkPeagesBPV');
    const chkEch = document.getElementById('chkPeagesEch');
    
    const vouloirAfficher = (chkBPV && chkBPV.checked) || (chkEch && chkEch.checked);

    if (vouloirAfficher) {
        // Si les données ne sont pas encore chargées, on injecte le script
        if (!couchePeages) {
            injecterScript('FICHIERS/PEAGES/Peages.js', () => {
                if (typeof donnees_Peages !== 'undefined') {
                     filtrerEtAfficherPeages();
                } else {
                    alert("Erreur lors de la lecture des données de Peages.js");
                }
            });
        } else {
            // Si le script est déjà là, on réapplique simplement le filtre sur la carte
            filtrerEtAfficherPeages();
        }
    } else {
        // Si aucune des deux cases n'est cochée, on enlève la couche de la carte
        if (couchePeages) map.removeLayer(couchePeages);
    }
	rafraichirAffichageLegende();
}

// Fonction interne pour appliquer le filtre à la volée (Pleine voie / Échangeur)
function filtrerEtAfficherPeages() {
    // 1. On nettoie TOUJOURS la carte en premier
    if (couchePeages) map.removeLayer(couchePeages);

    const afficherBPV = document.getElementById('chkPeagesBPV').checked;
    const afficherEch = document.getElementById('chkPeagesEch').checked;

    // 2. On recrée un groupe de calques Leaflet vide
    couchePeages = L.featureGroup();

    // 3. On charge les données GeoJSON avec le filtre corrigé
    L.geoJSON(window.donnees_Peages, {
        filter: function(feature) {
            const typeGare = feature.properties.typeGare_l || "";
            const typeMinuscule = typeGare.toLowerCase();
            
            // Détection des types
            const estBPV = typeMinuscule.includes("pleine voie") || typeMinuscule.includes("gare de péage");
            const estEch = typeMinuscule.includes("echangeur") || typeMinuscule.includes("échangeur");
            
            // Condition d'affichage stricte :
            if (estBPV && !afficherBPV) return false; // C'est un BPV mais la case BPV est décochée -> Masquer
            if (estEch && !afficherEch) return false; // C'est un Échangeur mais la case Échangeur est décochée -> Masquer
            
            // Si la case correspondante est cochée, on l'affiche
            return (estBPV && afficherBPV) || (estEch && afficherEch);
        },
        pointToLayer: function(feature, latlng) {
            // On appelle la fonction existante qui crée l'icône, la popup et la synchronisation avec les PR
            const coucheTemporaire = creerCouchePeages({ features: [feature] });
            let marqueurGenere = null;
            
            // On extrait le marqueur configuré
            coucheTemporaire.eachLayer(layer => { marqueurGenere = layer; });
            return marqueurGenere;
        }
    }).eachLayer(function(layer) {
        couchePeages.addLayer(layer);
    });

    // 4. On pousse le résultat filtré sur la carte
    couchePeages.addTo(map);
	actualiserTailleIcones();
}

// Liaison des deux nouvelles cases à cocher à la fonction de gestion
document.getElementById('chkPeagesBPV').addEventListener('change', gererAffichagePeages);
document.getElementById('chkPeagesEch').addEventListener('change', gererAffichagePeages);

const chkPeagesMain = document.getElementById('chkPeages');
    const chkBPV = document.getElementById('chkPeagesBPV');
    const chkEch = document.getElementById('chkPeagesEch');
    const divOptionsPeages = document.getElementById('options_Peages');

if (chkPeagesMain) {
        chkPeagesMain.addEventListener('change', function(e) {
            if (e.target.checked) {
                if (divOptionsPeages) divOptionsPeages.style.display = 'flex';
                
                // Coche par défaut les sous-cases
                if (chkBPV) chkBPV.checked = true;
                if (chkEch) chkEch.checked = true;

gererAffichagePeages();

				const legBPV = document.getElementById('legende_BPV');
                const legEchangeur = document.getElementById('legende_Echangeur');
                if (legBPV) legBPV.style.display = 'flex';
                if (legEchangeur) legEchangeur.style.display = 'flex';
			}
			else {
				chkBPV.checked = false;
                chkEch.checked = false;
				if (divOptionsPeages) divOptionsPeages.style.display = 'none';
				gererAffichagePeages();
				const legBPV = document.getElementById('legende_BPV');
                const legEchangeur = document.getElementById('legende_Echangeur');
                if (legBPV) legBPV.style.display = 'none';
                if (legEchangeur) legEchangeur.style.display = 'none';
			}
				
		});
}






// On pré-charge silencieusement les structures géographiques pour la saisie intuitive locale
injecterScript('FICHIERS/AIRES/Aires_C.js', () => {});
injecterScript('FICHIERS/AIRES/Aires_NC.js', () => {});
injecterScript('FICHIERS/PEAGES/Peages.js', () => {});


/* ---------------- ADAPTATION DYNAMIQUE DE LA TAILLE DES ICONES AU ZOOM ---------------- */
function actualiserTailleIcones() {
    const zoomActuel = map.getZoom();
    let nouvelleTaille = 24; // Taille de base par défaut (pour zoom <= 8)

    // Ajustement progressif de la taille selon le niveau de zoom
    if (zoomActuel > 8 && zoomActuel <= 10) {
        nouvelleTaille = 32;
    } else if (zoomActuel > 10 && zoomActuel <= 12) {
        nouvelleTaille = 38;
    } else if (zoomActuel > 12 && zoomActuel <= 14) {
        nouvelleTaille = 48;
    } else if (zoomActuel > 14 && zoomActuel <= 16) {
        nouvelleTaille = 62;
    } else if (zoomActuel > 16) {
        nouvelleTaille = 82;
    }
	nouvelleTaille = Math.round(nouvelleTaille * facteurZoomIcones);
    // 1. Application aux icônes classiques de type L.icon (Péages, Aires si configurées ainsi)
    const imagesIcones = document.querySelectorAll('.leaflet-marker-icon:not(.leaflet-div-icon)');
    imagesIcones.forEach(img => {
        img.style.width = nouvelleTaille + 'px';
        img.style.height = nouvelleTaille + 'px';
        
        // Recadrage des ancres pour que le marqueur reste centré sur ses coordonnées exactes
        img.style.marginLeft = -(nouvelleTaille / 2) + 'px';
        img.style.marginTop = -(nouvelleTaille / 2) + 'px';
    });

    // 2. Application si vous utilisez des L.divIcon personnalisés (facultatif mais assure la compatibilité)
    const blocsDivIcon = document.querySelectorAll('.conteneur-icone-peage');
    blocsDivIcon.forEach(div => {
        div.style.width = nouvelleTaille + 'px';
        div.style.height = nouvelleTaille + 'px';
        
        // Si présence d'un élément parent Leaflet pour le divIcon, on ajuste son ancrage
        const parentMarker = div.closest('.leaflet-marker-icon');
        if (parentMarker) {
            parentMarker.style.width = nouvelleTaille + 'px';
            parentMarker.style.height = nouvelleTaille + 'px';
            parentMarker.style.marginLeft = -(nouvelleTaille / 2) + 'px';
            parentMarker.style.marginTop = -(nouvelleTaille / 2) + 'px';
        }
    });
	// 3. APPLICATION AUX ÉCHANGEURS (En écrasant les styles inline de Leaflet)
    // On applique une taille légèrement plus petite pour garder les proportions d'origine (20px vs 24px)
    let tailleEchangeur = nouvelleTaille - 4; 
    const echangeursDOM = document.querySelectorAll('.icone-echangeur-zoom');
    echangeursDOM.forEach(img => {
        img.style.setProperty('width', tailleEchangeur + 'px', 'important');
        img.style.setProperty('height', tailleEchangeur + 'px', 'important');
        img.style.setProperty('margin-left', -(tailleEchangeur / 2) + 'px', 'important');
        img.style.setProperty('margin-top', -(tailleEchangeur / 2) + 'px', 'important');
    });
	
	// -------------------------------------------------------------------
    // 4. AJOUT : ADAPTATION DE LA TAILLE DES BORNES KILOMÉTRIQUES (PR)
    // -------------------------------------------------------------------
    // Calcul du facteur d'agrandissement par rapport à la largeur de base (34px)
    const echelleBorne = nouvelleTaille / 34;

    // A. Agrandir le conteneur Leaflet et ajuster son ancrage
    const marqueursBornes = document.querySelectorAll('.borne-rouge-marker, .borne-orange-marker');
    marqueursBornes.forEach(marker => {
        marker.style.width = nouvelleTaille + 'px';
        marker.style.height = (nouvelleTaille * 1.23) + 'px'; // Maintient le ratio hauteur/largeur d'origine (42/34)
        marker.style.marginLeft = -(nouvelleTaille / 2) + 'px';
        marker.style.marginTop = -(nouvelleTaille * 1.23) + 'px'; // Ancrage en bas au centre
    });

    // B. Appliquer le scale CSS sur le dessin interne de la borne (sauf les boutons de la toolbar)
    const dessinsBornes = document.querySelectorAll('.leaflet-marker-pane .borne-pr');
    dessinsBornes.forEach(borne => {
        borne.style.transform = `scale(${echelleBorne})`;
        borne.style.transformOrigin = 'bottom center'; // S'agrandit vers le haut sans décaler la pointe de la borne
    });
}

map.on('zoomend', actualiserTailleIcones);




/* ---------------- GESTION DYNAMIQUE DE LA LÉGENDE ---------------- */

function mettreAJourLegende() {
    // Aires
    //const chkAiresC = document.getElementById('chkAiresC');
    //const chkAiresNC = document.getElementById('chkAiresNC');
    //const afficherAires = (chkAiresC && chkAiresC.checked) || (chkAiresNC && chkAiresNC.checked);
    
    
	
	const chkAiresCS = document.getElementById('chkAiresC_S');
    const chkAiresNCS = document.getElementById('chkAiresNC_S');
    const afficherAiresS = (chkAiresCS && chkAiresCS.checked) || (chkAiresNCS && chkAiresNCS.checked);
	
	const chkAiresCR = document.getElementById('chkAiresC_R');
    const chkAiresNCR = document.getElementById('chkAiresNC_R');
    const afficherAiresR = (chkAiresCR && chkAiresCR.checked) || (chkAiresNCR && chkAiresNCR.checked);
	
	const chkAiresCA = document.getElementById('chkAiresC_Autre');
    const chkAiresNCA = document.getElementById('chkAiresNC_Autre');
    const afficherAiresA = (chkAiresCA && chkAiresCA.checked) || (chkAiresNCA && chkAiresNCA.checked);
	
	const legAiresRepos = document.getElementById('legende_AiresRepos');
    const legAiresService = document.getElementById('legende_AiresService');
    if (legAiresRepos) legAiresRepos.style.display = afficherAiresR ? 'flex' : 'none';
    if (legAiresService) legAiresService.style.display = afficherAiresS ? 'flex' : 'none';
	const legAiresAutre = document.getElementById('legende_AiresAutres');
	if (legAiresAutre) legAiresAutre.style.display = afficherAiresA ? 'flex' : 'none';

    // Péages
    const chkBPV = document.getElementById('chkPeagesBPV');
    const chkEch = document.getElementById('chkPeagesEch');
    const afficherBPV = (chkBPV && chkBPV.checked);
    const afficherEch = (chkEch && chkEch.checked);
    const legBPV = document.getElementById('legende_BPV');
    const legEch = document.getElementById('legende_Echangeur');
    if (legBPV) legBPV.style.display = afficherBPV ? 'flex' : 'none';
    if (legEch) legEch.style.display = afficherEch ? 'flex' : 'none';
	
	
	//échangeurs
	const chkBif = document.getElementById('chkEch_Bifurcation');
    const chkDif = document.getElementById('chkEch_Diffuseur');
	const chkMixte = document.getElementById('chkEch_Mixte');
    const afficherBif = (chkBif && chkBif.checked);
    const afficherDif = (chkDif && chkDif.checked);
	const afficherMixte = (chkMixte && chkMixte.checked);
    const legBif = document.getElementById('legende_Ech_Bifurcation');
    const legDif = document.getElementById('legende_Ech_Diffuseur');
	const legMixte = document.getElementById('legende_Ech_Mixte');
    if (legBif) legBif.style.display = afficherBif ? 'flex' : 'none';
    if (legDif) legDif.style.display = afficherDif ? 'flex' : 'none';
	if (legMixte) legMixte.style.display = afficherMixte ? 'flex' : 'none';
	
	const legAireC = document.getElementById('legende_Qualicharge_AireC');
			const legAireNC = document.getElementById('legende_Qualicharge_AireNC');
			const chk_AfficherAiresC = document.getElementById('chkAfficher_Aires_C');
			const chk_AfficherAiresNC = document.getElementById('chkAfficher_Aires_NC');
			if (legAireC) legAireC.style.display = (chk_AfficherAiresC && chk_AfficherAiresC.checked) ? 'flex' : 'none';
			if (legAireNC) legAireNC.style.display = (chk_AfficherAiresNC && chk_AfficherAiresNC.checked) ? 'flex' : 'none';
	
	
}


// Liaison de l'événement sur chaque case à cocher existante pour rafraîchir la légende en temps réel
['chkAiresC', 'chkAiresNC', 'chkPeagesBPV', 'chkPeagesEch', 'chkEch_Bifurcation', 'chkEch_Diffuseur', 'chkEch_Mixte', 'chkAires'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('change', () => {
            mettreAJourLegende();
            if (typeof rafraichirAffichageLegende === 'function') {
                rafraichirAffichageLegende();
            }
        });
    }
});

// Appel initial pour synchroniser la légende avec les cases cochées au chargement de la page
document.addEventListener("DOMContentLoaded", mettreAJourLegende);
// Sécurité si l'initialisation a déjà eu lieu
mettreAJourLegende();
initialiserEcouteursCarrefours();



/* ---------------- COUCHE ET GESTION DU CADASTRE CLIQUABLE (IGN) ---------------- */

// 1. Définition de la couche WMS des parcelles
const coucheCadastre = L.tileLayer.wms('https://data.geopf.fr/wms-r', {
    layers: 'CADASTRALPARCELS.PARCELS',
    format: 'image/png',
    transparent: true,
    opacity: 0.6,
    version: '1.3.0',
    attribution: '© IGN / Cadastre'
});

// 2. Fonction déclenchée au clic sur la carte pour interroger l'API Cadastre

// Fonction déclenchée au clic sur la carte pour interroger l'API Cadastre
function requeteInfoCadastre(e) {
    // Si la case Cadastre n'est pas cochée, on ne fait rien
    if (!document.getElementById('chkCadastre').checked) return;

    // Supprime le précédent tracé violet s'il existe
    if (contourParcelleSelectionnee) {
        map.removeLayer(contourParcelleSelectionnee);
        contourParcelleSelectionnee = null;
    }

    const lat = e.latlng.lat;
    const lon = e.latlng.lng;

    // Utilisation de l'API Apicarto de l'IGN (Recherche par intersection de coordonnées)
    // Cette API renvoie directement le vrai polygone GeoJSON de la parcelle cliquée
    const url = `https://apicarto.ign.fr/api/cadastre/parcelle?geom={"type":"Point","coordinates":[${lon},${lat}]}`;

    fetch(url)
        .then(response => {
            if (!response.ok) {
                // Si le serveur renvoie une erreur (ex: clic hors de France ou zone sans données)
                throw new Error("Aucune parcelle trouvée à cet endroit.");
            }
            return response.json();
        })
        .then(data => {
            // L'API Apicarto renvoie un FeatureCollection GeoJSON standardisé
            if (data && data.features && data.features.length > 0) {
                const feature = data.features[0];
                const proprietes = feature.properties;

                // 1. COLORATION EN VIOLET DE LA PARCELLE ENTIÈRE
                // Leaflet applique le style sur le vrai polygone vectoriel fourni par l'API
                contourParcelleSelectionnee = L.geoJSON(feature, {
                    style: {
                        color: 'purple',       // Couleur des bordures de la parcelle
                        weight: 2,            // Épaisseur de la ligne
                        fillColor: '#9b59b6', // Couleur de remplissage de la parcelle
                        fillOpacity: 0.4      // Transparence du violet (40%)
                    }
                }).addTo(map);

                // 2. Extraction des caractéristiques textuelles propres à Apicarto
                const codeCommune = proprietes.code_insee || "Inconnu";
                const nomCommune = proprietes.nom_com || "Non renseignée";
                const section = proprietes.section || "Inconnue";
                const numero = proprietes.numero || "Inconnu";
                const idParcelle = proprietes.id || (codeCommune + "000" + section + numero);

                // Construction de la Popup
                const contenuPopup = `
                    <div style="font-family: Arial, sans-serif; font-size: 12px; text-align: left;">
                        <b style="color: #2c3e50; font-size: 13px;">Caractéristiques Cadastre</b><br><br>
                        <b>Commune :</b> ${nomCommune} (${codeCommune})<br>
                        <b>Section :</b> ${section}<br>
                        <b>Numéro :</b> ${numero}<br>
                        <span style="font-size: 10px; color: #7f8c8d;">ID : ${idParcelle}</span>
                    </div>
                `;

                // Affichage de la popup à l'endroit exact du clic
                L.popup()
                    .setLatLng(e.latlng)
                    .setContent(contenuPopup)
                    .openOn(map);

                // Nettoyage de la couche violette si l'utilisateur ferme la popup
                map.on('popupclose', function(event) {
                    if (contourParcelleSelectionnee && event.popup === map._popup) {
                        map.removeLayer(contourParcelleSelectionnee);
                        contourParcelleSelectionnee = null;
                    }
                });
            }
        })
        .catch(error => {
            console.warn("Information Cadastre :", error.message);
        });
}

// 3. Liaison de la case à cocher pour activer/désactiver la couche et l'écouteur de clic
const chkCadastre = document.getElementById('chkCadastre');
if (chkCadastre) {
    chkCadastre.addEventListener('change', function(e) {
        if (e.target.checked) {
            coucheCadastre.addTo(map);
            // On active le clic sur la carte pour le cadastre
            map.on('click', requeteInfoCadastre);
        } else {
            map.removeLayer(coucheCadastre);
            // On désactive le clic pour ne pas interférer avec le reste du site
            map.off('click', requeteInfoCadastre);
			map.closePopup();
        }
    });
}






// QUALICHARGE


// Variable d'état pour mémoriser si la source actuelle est le fichier de secours archivé



let estDonneesSecoursQualicharge = false;

function parserLigneCSVQualicharge(ligne, separateur) {
    let colonnes = [];
    let colonneActuelle = "";
    let dansLesGuillemets = false;

    for (let i = 0; i < ligne.length; i++) {
        let char = ligne[i];

        if (char === '"') {
            dansLesGuillemets = !dansLesGuillemets; // Bascule l'état dès qu'on croise un guillemet
        } else if (char === separateur && !dansLesGuillemets) {
            colonnes.push(colonneActuelle.trim().replace(/^"|"$/g, ''));
            colonneActuelle = "";
        } else {
            colonneActuelle += char;
        }
    }
    colonnes.push(colonneActuelle.trim().replace(/^"|"$/g, ''));
    return colonnes;
}

function parserCSVQualicharge(texteCSV) {
    const lignes = texteCSV.replace(/\r/g, "").split('\n');
    if (lignes.length < 2) return [];

    let separateur = ",";
    if (lignes[0].indexOf(";") !== -1) separateur = ";";

    const entetes = lignes[0].split(separateur).map(e => e.trim().replace(/^"|"$/g, ''));
    
    const indexXY = entetes.indexOf('coordonneesXY');
    const indexNom = entetes.indexOf('nom_station');
    const indexOperateur = entetes.indexOf('nom_operateur');
    const indexAmenageur = entetes.indexOf('nom_amenageur');
    const indexPuissance = entetes.indexOf('puissance_nominale');

    // Étape 1 : Regroupement initial par coordonnées géographiques exactes
    const groupesParCoordonnees = {};
    const regexPLStricte = /(?:^|[^a-zA-Zà-ÿÀ-Ÿ])PL(?:$|[^a-zA-Zà-ÿÀ-Ÿ])|\bP\.L\./;

    for (let i = 1; i < lignes.length; i++) {
        if (!lignes[i].trim()) continue;
        
        const colonnesNettoyees = parserLigneCSVQualicharge(lignes[i], separateur);
        if (colonnesNettoyees.length < entetes.length) continue;
        
        let lat = null;
        let lon = null;
        const valeurXY = colonnesNettoyees[indexXY];

        if (indexXY !== -1 && valeurXY) {
            const cleanStr = valeurXY.replace(/[\[\]\s"']/g, '');
            const parts = cleanStr.split(',');
            
            if (parts.length === 2) {
                const val1 = parseFloat(parts[0]);
                const val2 = parseFloat(parts[1]);
                
                if (Math.abs(val1) < 15 && val2 > 35) { 
                    lon = val1; lat = val2; 
                } else { 
                    lat = val1; lon = val2; 
                }
            }
        }

        if (lat && lon && !isNaN(lat) && !isNaN(lon)) {
            const cleGeo = `${lat.toFixed(5)}_${lon.toFixed(5)}`;
            
            const nomStation = colonnesNettoyees[indexNom] || "Borne sans nom";
            const operateur = colonnesNettoyees[indexOperateur] || "Inconnu";
            const amenageur = colonnesNettoyees[indexAmenageur] || "Inconnu";
            const puissance = colonnesNettoyees[indexPuissance] ? parseFloat(parseFloat(colonnesNettoyees[indexPuissance]).toFixed(1)) : null;

            let typeIdentifie = "VL";
            if (nomStation.toLowerCase().includes("truck") || regexPLStricte.test(nomStation)) {    
                typeIdentifie = "PL";
            }

            if (!groupesParCoordonnees[cleGeo]) {
                groupesParCoordonnees[cleGeo] = {
                    lat: lat,
                    lon: lon,
                    lignes: []
                };
            }
            
            groupesParCoordonnees[cleGeo].lignes.push({
                nom: nomStation,
                op: operateur,
                am: amenageur,
                p: puissance,
                t: typeIdentifie
            });
        }
    }

    const stationsTraitees = [];

    // Étape 2 : Application fine des règles de tri et scission VL / PL par coordonnée
    Object.values(groupesParCoordonnees).forEach(groupe => {
        const lignesGroupe = groupe.lignes;
        
        // On sépare d'abord le groupe en deux sous-ensembles (VL et PL)
        const lignesVL = lignesGroupe.filter(l => l.t === "VL");
        const lignesPL = lignesGroupe.filter(l => l.t === "PL");

        // Traitement du bloc VL s'il existe
        if (lignesVL.length > 0) {
            const sousStationsVL = determinerSousStationsPourGroupe(lignesVL);
            stationsTraitees.push({
                a: groupe.lat,
                o: groupe.lon,
                t: "VL",
                s: sousStationsVL
            });
        }

        // Traitement du bloc PL s'il existe (génèrera un point distinct superposé)
        if (lignesPL.length > 0) {
            const sousStationsPL = determinerSousStationsPourGroupe(lignesPL);
            stationsTraitees.push({
                a: groupe.lat,
                o: groupe.lon,
                t: "PL",
                s: sousStationsPL
            });
        }
    });


localStorage.removeItem('stations_carrefours_json');
    window.stationsCarrefoursTrouvees = null;
    return stationsTraitees;
}

// Fonction interne pour appliquer les règles d'aménageurs/opérateurs sur un groupe de même type (VL ou PL)
function determinerSousStationsPourGroupe(lignesGroupe) {
    const sousStationsFinales = [];
    const amenageursUniques = [...new Set(lignesGroupe.map(l => l.am))];

    if (amenageursUniques.length === 1) {
        sousStationsFinales.push(genererSousStation(lignesGroupe));
    } else {
        const operateursUniques = [...new Set(lignesGroupe.map(l => l.op))];
        
        if (operateursUniques.length > 1) {
            const comptesOp = {};
            lignesGroupe.forEach(l => comptesOp[l.op] = (comptesOp[l.op] || 0) + 1);
            
            let meilleurOp = "";
            let maxLignes = -1;
            Object.keys(comptesOp).forEach(op => {
                if (comptesOp[op] > maxLignes) {
                    maxLignes = comptesOp[op];
                    meilleurOp = op;
                }
            });
            
            const lignesFiltreesOp = lignesGroupe.filter(l => l.op === meilleurOp);
            sousStationsFinales.push(genererSousStation(lignesFiltreesOp));
        } else {
            amenageursUniques.forEach(am => {
                const lignesFiltreesAm = lignesGroupe.filter(l => l.am === am);
                sousStationsFinales.push(genererSousStation(lignesFiltreesAm));
            });
        }
    }
    return sousStationsFinales;
}

// Fonction utilitaire pour regrouper un set de lignes qualicharge en une structure condensée
function genererSousStation(lignes) {
    const premiere = lignes[0];
    const dictPuissances = {};
    let typeFinal = "VL";

    lignes.forEach(l => {
        if (l.p !== null && l.p !== undefined) {
            // On stocke la puissance sous forme de clé stringifiée propre
            dictPuissances[l.p] = (dictPuissances[l.p] || 0) + 1;
        }
        if (l.t === "PL") {
            typeFinal = "PL";
        }
    });

    // Tri numérique strict des clés (converties en nombres pour le tri)
    const clesPuissances = Object.keys(dictPuissances).map(Number).sort((x, y) => x - y);
    
    // Construction de la chaîne en affichant la clé brute (qui aura sa décimale si nécessaire)
    const chainePuissance = clesPuissances.map(p => `${dictPuissances[p]}x${p} kW`).join(' + ') || "Inconnue";
	
    return {
        n: premiere.nom,
        m: premiere.op,
        am: premiere.am,
        p: lignes.length,
        u: chainePuissance,
        t: typeFinal
    };
}

// Calcule et affiche les totaux (X) à côté des libellés VL et PL via leurs ID span
function mettreAJourCompteursLabels() {
    if (!baseQualichargeTraitee) {
        console.warn("Mise à jour des compteurs impossible : baseQualichargeTraitee est vide.");
        return;
    }

    let totalVL = 0;
    let totalPL = 0;

    baseQualichargeTraitee.forEach(station => {
        station.s.forEach(subStation => {
            if (subStation.t === "PL") totalPL++;
            else totalVL++;
        });
    });

    console.log(`Calcul des compteurs Qualicharge terminé : VL = ${totalVL}, PL = ${totalPL}`);

    setTimeout(() => {
        const spanVL = document.getElementById('label_Qualicharge_VL');
        const spanPL = document.getElementById('label_Qualicharge_PL');

        if (spanVL) spanVL.textContent = `Stations VL (${totalVL})`;
        if (spanPL) spanPL.textContent = `Stations PL (${totalPL})`;
    }, 50);
}

function filtrerEtAfficherQualicharge() {
    if (!map.hasLayer(coucheQualicharge) || !baseQualichargeTraitee) return;

    coucheQualicharge.clearLayers();
    const bounds = map.getBounds();
    let compteurs = 0;

    const chkVL = document.getElementById('chkQualicharge_VL');
    const chkPL = document.getElementById('chkQualicharge_PL');
    const afficherVL = chkVL ? chkVL.checked : true;
    const afficherPL = chkPL ? chkPL.checked : true;
    
    const legendeVL = document.getElementById('legende_Qualicharge_VL');
    const legendePL = document.getElementById('legende_Qualicharge_PL');
    if (legendeVL) legendeVL.style.display = afficherVL ? 'flex' : 'none';
    if (legendePL) legendePL.style.display = afficherPL ? 'flex' : 'none';
	
	const legAireC = document.getElementById('legende_Qualicharge_AireC');
			const legAireNC = document.getElementById('legende_Qualicharge_AireNC');
			const chk_AfficherAiresC = document.getElementById('chkAfficher_Aires_C');
			const chk_AfficherAiresNC = document.getElementById('chkAfficher_Aires_NC');
			if (legAireC) legAireC.style.display = (chk_AfficherAiresC && chk_AfficherAiresC.checked) ? 'flex' : 'none';
			if (legAireNC) legAireNC.style.display = (chk_AfficherAiresNC && chk_AfficherAiresNC.checked) ? 'flex' : 'none';
	
	
    
    const zoomActuel = map.getZoom();
    const facteurZoom = Math.max(0.5, zoomActuel / 10);
	
	// EXPOSITION GLOBALE : Simule un clic natif Leaflet sur la carte
    window.rechercherAxeLePlusProcheQualicharge = function(lat, lon) {
        if (map) {
            const coordonnees = L.latLng(lat, lon);
            
            
            map.fire('click', {
                latlng: coordonnees,
                target: map, // Résout l'erreur "Cannot read properties of undefined (reading 'target')"
                sourceTarget: map,
                layerPoint: map.latLngToLayerPoint(coordonnees),
                containerPoint: map.latLngToContainerPoint(coordonnees),
                originalEvent: {
                    target: map.getContainer(),
                    srcElement: map.getContainer()
                }
            });
        } else {
            console.error("L'objet global 'map' est introuvable.");
        }
    };

    baseQualichargeTraitee.forEach(borne => {
        if (bounds.contains([borne.a, borne.o])) {
            if (borne.t === "VL" && !afficherVL) return;
            if (borne.t === "PL" && !afficherPL) return;

            compteurs++;

            // ================= REGROUPEMENT POUR LE POPUP MULTICOLONNE =================
            // On recherche TOUTES les sous-stations (VL et PL) ayant les mêmes coordonnées
            let toutesLesSousStationsDuPoint = [];
            baseQualichargeTraitee.forEach(b => {
                if (b.a === borne.a && b.o === borne.o) {
                    toutesLesSousStationsDuPoint = toutesLesSousStationsDuPoint.concat(b.s);
                }
            });
            // ===========================================================================

            // Construction du tableau HTML multicolonne avec toutes les stations trouvées
            let htmlPopup = `
                <div style="font-family: Arial, sans-serif; max-width: 550px;">
                    <h4 style="margin: 0 0 10px 0; color: #2c3e50; border-bottom: 2px solid #34495e; padding-bottom: 5px;">
                        📍 Stations aux coordonnées [${borne.a}, ${borne.o}]
                    </h4>
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: left;">
                            <thead>
                                <tr style="background-color: #f2f2f2; border-bottom: 1px solid #ddd;">
                                    <th style="padding: 6px; font-weight: bold;">Nom de la Station</th>
                                    <th style="padding: 6px; font-weight: bold;">Opérateur</th>
                                    <th style="padding: 6px; font-weight: bold;">Aménageur</th>
                                    <th style="padding: 6px; font-weight: bold; text-align: center;">Usage</th>
                                    <th style="padding: 6px; font-weight: bold; text-align: center;">PDC</th>
                                    <th style="padding: 6px; font-weight: bold;">Puissances (kW)</th>
                                </tr>
                            </thead>
                            <tbody>
            `;

            // On boucle sur TOUTES les sous-stations (VL + PL) de cette position géographique
            toutesLesSousStationsDuPoint.forEach((sub, index) => {
                const bgRow = index % 2 === 0 ? "#ffffff" : "#f9f9f9";
                const badgeColor = sub.t === "PL" ? "#e74c3c" : "#0078ff";
                
                htmlPopup += `
                    <tr style="background-color: ${bgRow}; border-bottom: 1px solid #eee;">
                        <td style="padding: 6px; font-weight: bold; color: #333;">${sub.n}</td>
                        <td style="padding: 6px; color: #555;">${sub.m}</td>
                        <td style="padding: 6px; color: #555;">${sub.am}</td>
                        <td style="padding: 6px; text-align: center;">
                            <span style="background-color: ${badgeColor}; color: white; padding: 2px 6px; border-radius: 3px; font-size: 9px; font-weight: bold;">
                                ${sub.t}
                            </span>
                        </td>
                        <td style="padding: 6px; text-align: center; font-weight: bold; color: #2c3e50;">${sub.p}</td>
                        <td style="padding: 6px; color: #27ae60; font-weight: bold;">${sub.u}</td>
                    </tr>
                `;
            });

            // Boutons d'action géographiques (Axe le plus proche et Google Street View)
			const coordsStr = `${borne.a},${borne.o}`;
            const lienStreetView = `<a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${borne.a},${borne.o}" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/StreetView.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Street View"> StreetView</a>  <a href="https://www.google.com/maps/search/?api=1&query=${borne.a},${borne.o}&basemap=roadmap" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Maps.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Maps"> Maps</a>  <a href="https://earth.google.com/web/@${borne.a},${borne.o},100a,350d,35y,0h,0t,0r" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Earth.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Earth"> Earth</a>`;
            const boutonTrouverAxe = `<button onclick="window.rechercherAxeLePlusProcheQualicharge(${borne.a}, ${borne.o}, this)" style="padding: 4px 8px; font-size: 10px; background-color: #34495e; color: white; border: none; border-radius: 3px; cursor: pointer;">🔍 Identifier l'Axe routier</button>`;

            htmlPopup += `
                            </tbody>
                        </table>
                    </div>
                    <div style="margin-top: 12px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #ddd; padding-top: 8px;">
                        ${boutonTrouverAxe}
                        ${lienStreetView}
                    </div>
                </div>
            `;

            // Configuration et taille du marqueur circulaire Leaflet
            const rayonBase = borne.t === "PL" ? 8 : 6;

            const marqueur = L.circleMarker([borne.a, borne.o], {
                radius: rayonBase * facteurZoom,
                fillColor: borne.t === "PL" ? "#e74c3c" : "#0078ff",
                color: "#ffffff",
                weight: 1.5,
                fillOpacity: 0.8
            }).bindPopup(htmlPopup, { maxWidth: 600 });

            coucheQualicharge.addLayer(marqueur);
        }
    });

    console.log(`${compteurs} points Qualicharge affichés à l'écran.`);
}

function exporterQualichargeExcel() {
    if (!baseQualichargeTraitee || baseQualichargeTraitee.length === 0) {
        alert("Aucune donnée Qualicharge disponible pour l'export.");
        return;
    }

    const donneesExcel = [];
    baseQualichargeTraitee.forEach(borne => {
        borne.s.forEach(sub => {
            donneesExcel.push({
                "Nom de la Station": sub.n,
                "Opérateur": sub.m,
                "Aménageur": sub.am,
                "Type": sub.t,
                "Nombre de PDC": sub.p,
                "Configuration Puissances": sub.u,
                "Latitude": borne.a,
                "Longitude": borne.o
            });
        });
    });

    const feuille = XLSX.utils.json_to_sheet(donneesExcel);
    const classeur = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(classeur, feuille, "Stations Qualicharge");

    const dateCache = localStorage.getItem('qualicharge_cache_date') || new Date().toISOString().split('T')[0];
    XLSX.writeFile(classeur, `Qualicharge_Filtre_${dateCache}.xlsx`);
}




// Fonction isolée pour gérer le séquençage et la bascule de secours (compatible file:// et CORS)
function executerTelechargementQualicharge(urlPrincipale, urlSecours, dateDuJour, lblStatut, cacheDonneesFiltrees, cacheDate) {
    fetch(urlPrincipale)
        .then(response => {
            if (!response.ok) throw new Error("Erreur HTTP API principale");
            return response.text();
        })
        .then(texteCSV => {
            console.log("Données principales Qualicharge téléchargées avec succès.");
			estDonneesSecoursQualicharge = false; // Source principale OK
            baseQualichargeTraitee = parserCSVQualicharge(texteCSV);
            try {
                localStorage.setItem('qualicharge_filtree_json', JSON.stringify(baseQualichargeTraitee));
                localStorage.setItem('qualicharge_cache_date', dateDuJour);
            } catch(e) { console.warn("localStorage saturé."); }
            
            if (lblStatut) {
                lblStatut.style.color = "#2c3e50";
                lblStatut.textContent = `Données Qualicharge du ${dateDuJour.split('-').reverse().join('/')}`;
            }
            mettreAJourCompteursLabels();
            filtrerEtAfficherQualicharge();
        })
        .catch(error => {
            console.warn("Échec URL principale. Tentative fichier de secours local...", error);
            
            // CONTOURNEMENT CORS POUR FILE:// 
            // On change l'extension de secours vers .js si on détecte une exécution locale directe
            let cheminSecours = urlSecours;
            if (window.location.protocol === 'file:') {
                cheminSecours = urlSecours.replace('.csv', '.js');
            }

            // Création d'une balise script pour charger le fichier de secours sans blocage CORS
            const scriptSecours = document.createElement('script');
            scriptSecours.src = cheminSecours;
            
            scriptSecours.onload = function() {
                // On utilise la variable textuelle standard générée par Python
                if (window.donneesSecoursQualicharge) {
                    console.log("Fichier de secours local (.js) chargé avec succès.");
                    estDonneesSecoursQualicharge = true; // Passage sur les données de secours
                    // Passage direct du texte nettoyé au parser habituel !
                    baseQualichargeTraitee = parserCSVQualicharge(window.donneesSecoursQualicharge);
                    
                    if (lblStatut) {
                        lblStatut.style.color = "red";
                        // Récupération de la date du fichier JS de secours si disponible
                        if (window.dateSecoursQualicharge) {
                            const dateFormatee = window.dateSecoursQualicharge.split('-').reverse().join('/');
                            lblStatut.textContent = `⚠️ Téléchargement impossible. Utilisation des données archivées du ${dateFormatee}`;
                        } else {
                            lblStatut.textContent = "⚠️ Téléchargement impossible. Utilisation des données archivées";
                        }
                    }

                    mettreAJourCompteursLabels();
                    filtrerEtAfficherQualicharge();
                    
                    // Nettoyage
                    delete window.donneesSecoursQualicharge;
                    scriptSecours.remove();
                } else {
                    gérerEchecTotalQualicharge(lblStatut, cacheDonneesFiltrees, cacheDate);
                    scriptSecours.remove();
                }
            };

            scriptSecours.onerror = function() {
                console.error("Échec du chargement du fichier de secours local.");
                gérerEchecTotalQualicharge(lblStatut, cacheDonneesFiltrees, cacheDate);
                scriptSecours.remove();
            };

            document.head.appendChild(scriptSecours);
        });
}

// Fonction utilitaire en cas de panne réseau + absence de fichier local valide
function gérerEchecTotalQualicharge(lblStatut, cacheDonneesFiltrees, cacheDate) {
    if (cacheDonneesFiltrees) {
        console.log("Restauration via l'ancien cache disponible.");
		estDonneesSecoursQualicharge = false; // Cache ancien
        if (lblStatut) {
            lblStatut.style.color = "#7f8c8d";
            lblStatut.textContent = `Données Qualicharge du ${cacheDate.split('-').reverse().join('/')} (Ancien cache)`;
        }
        baseQualichargeTraitee = JSON.parse(cacheDonneesFiltrees);
        mettreAJourCompteursLabels();
        filtrerEtAfficherQualicharge();
    } else {
		estDonneesSecoursQualicharge = false;
        if (lblStatut) {
            lblStatut.style.color = "red";
            lblStatut.textContent = "Erreur de téléchargement";
        }
    }
}

function chargerDonneesQualicharge() {
    if (map.hasLayer(coucheQualicharge)) return;



			
			
    coucheQualicharge.addTo(map);

    //const divLegende = document.getElementById('legende_Qualicharge');
    const lblStatut = document.getElementById('statutQualicharge');
    const divOptions = document.getElementById('options_Qualicharge');
              

const legendeVL = document.getElementById('legende_Qualicharge_VL');
    const legendePL = document.getElementById('legende_Qualicharge_PL');
    if (legendeVL) legendeVL.style.display = 'flex';
    if (legendePL) legendePL.style.display = 'flex';			  
   // if (divLegende) divLegende.style.display = 'flex';
    if (divOptions) divOptions.style.display = 'flex';
   if (lblStatut) {
        lblStatut.style.display = 'block';
        // ÉTAPE 1 : Affichage instantané du message d'attente
        lblStatut.style.color = "orange";
        lblStatut.textContent = "⏳Chargement en cours...";
    }

    const urlCSV = "https://www.data.gouv.fr/api/1/datasets/r/8bb0a6e2-1016-42ba-aaee-f72f55c82e9f";
    const urlSecours = "FICHIERS/QUALICHARGE/qualicharge.csv";
    const dateDuJour = new Date().toISOString().split('T')[0];
    
    const cacheDonneesFiltrees = localStorage.getItem('qualicharge_filtree_json');
    const cacheDate = localStorage.getItem('qualicharge_cache_date');
    
    if (baseQualichargeTraitee) {
		setTimeout(() => {
        if (lblStatut) {
            if (estDonneesSecoursQualicharge) {
                lblStatut.style.color = "red";
                if (window.dateSecoursQualicharge) {
                    const dateFormatee = window.dateSecoursQualicharge.split('-').reverse().join('/');
                    lblStatut.textContent = `⚠️ Téléchargement impossible. Utilisation des données archivées du ${dateFormatee}`;
                } else {
                    lblStatut.textContent = "⚠️ Téléchargement impossible. Utilisation des données archivées";
                }
            } else {
                lblStatut.style.color = "#2c3e50";
                let cibleDate = cacheDate || dateDuJour;
                lblStatut.textContent = `Données Qualicharge du ${cibleDate.split('-').reverse().join('/')}`;
            }
        }
        mettreAJourCompteursLabels();
        filtrerEtAfficherQualicharge();
		// AJOUT : On force la légende à recalculer sa visibilité maintenant que les bornes sont affichées
            if (typeof rafraichirAffichageLegende === 'function') {
                rafraichirAffichageLegende();
			}
		},50);
        return;

    }
                
    if (cacheDonneesFiltrees && cacheDate === dateDuJour) {
		
        
        console.log("Lecture du cache local mis à jour.");
		
		setTimeout(() => {
        estDonneesSecoursQualicharge = false;
        baseQualichargeTraitee = JSON.parse(cacheDonneesFiltrees);
        mettreAJourCompteursLabels();
        filtrerEtAfficherQualicharge();
		
		if (lblStatut) {
            lblStatut.style.color = "#2c3e50";
            lblStatut.textContent = `Données Qualicharge du ${cacheDate.split('-').reverse().join('/')}`;
        }if (typeof rafraichirAffichageLegende === 'function') {
                rafraichirAffichageLegende();
		}
		}, 50);
    } else {
        if (lblStatut) {
            lblStatut.style.color = "orange";
            lblStatut.textContent = "⏳Téléchargement en cours...";
        }
		if (typeof rafraichirAffichageLegende === 'function') {
                rafraichirAffichageLegende();
			}
        // Lancement sécurisé de la procédure de téléchargement avec sa logique de repli
        executerTelechargementQualicharge(urlCSV, urlSecours, dateDuJour, lblStatut, cacheDonneesFiltrees, cacheDate);
    }
}

function initialiserEcouteurQualicharge() {
    const chkQualicharge = document.getElementById('chkQualicharge');
    const chkVL = document.getElementById('chkQualicharge_VL');
    const chkPL = document.getElementById('chkQualicharge_PL');
    const btnExport = document.getElementById('btnExportQualicharge');
    const divOptions = document.getElementById('options_Qualicharge');
    const lblStatut = document.getElementById('statutQualicharge');
    const btnReset = document.getElementById('btnReset');
    
    if (chkQualicharge) {
		
		
			
			
        chkQualicharge.addEventListener('change', function(e) {
            if (e.target.checked) {
				
			
                chargerDonneesQualicharge();
				if (typeof rafraichirAffichageLegende === 'function') {
                rafraichirAffichageLegende();
			}
            } else {
                map.removeLayer(coucheQualicharge);
				
				if (map.hasLayer(coucheStationsAires)) map.removeLayer(coucheStationsAires); 
				if (typeof coucheStationsAires !== 'undefined') coucheStationsAires.clearLayers();
				
				if (map.hasLayer(coucheCarrefours)) map.removeLayer(coucheCarrefours); 
				if (typeof coucheCarrefours !== 'undefined') coucheCarrefours.clearLayers();
				
				
				const chkFiltrerAiresHTML = document.getElementById('chkFiltrerStationsAires');
                if (chkFiltrerAiresHTML) chkFiltrerAiresHTML.checked = false;
                if (chkVL) chkVL.checked = true;
                if (chkPL) chkPL.checked = true;
				
				const chkFiltrerCarrefours = document.getElementById('chkFiltrerCarrefours');
                if (chkFiltrerCarrefours) chkFiltrerCarrefours.checked = false;
                
				const legAireC = document.getElementById('legende_Qualicharge_AireC');
				const legAireNC = document.getElementById('legende_Qualicharge_AireNC');
				const legCarrefour = document.getElementById('legende_Qualicharge_Carrefour');
				
				if(legAireC) legAireC.style.display = 'none';
				if(legAireNC) legAireNC.style.display = 'none';
				if(legCarrefour) legCarrefour.style.display = 'none';

                // 3. Permuter l'affichage HTML pour remettre les éléments VL / PL visibles par défaut
                const wlVL = document.getElementById('wrapper_Qualicharge_VL');
                const wlPL = document.getElementById('wrapper_Qualicharge_PL');
                const wlAiresC = document.getElementById('wrapper_Aires_C');
                const wlAiresNC = document.getElementById('wrapper_Aires_NC');

                if (wlVL) wlVL.style.display = 'inline-block';
                if (wlPL) wlPL.style.display = 'inline-block';
                if (wlAiresC) wlAiresC.style.display = 'none';
                if (wlAiresNC) wlAiresNC.style.display = 'none';
				
				
                const divLegende = document.getElementById('legende_Qualicharge');
                if (divLegende) divLegende.style.display = 'none';
                if (divOptions) divOptions.style.display = 'none';
                if (lblStatut) lblStatut.style.display = 'none';
				
			
                
                const legendeVL = document.getElementById('legende_Qualicharge_VL');
                const legendePL = document.getElementById('legende_Qualicharge_PL');
				//const legendeAires = document.getElementById('legende_Qualicharge_Aires'); // <-- FORCE MASQUAGE
                if (legendeVL) legendeVL.style.display = 'none';
                if (legendePL) legendePL.style.display = 'none';
				//if (legendeAires) legendeAires.style.display = 'none'; // <-- FORCE MASQUAGE
				
				// Forcer le rafraîchissement géométrique de la légende globale
                if (typeof rafraichirAffichageLegende === 'function') {
                    rafraichirAffichageLegende();
				}
            }
        });
    }

    if (chkVL) chkVL.addEventListener('change', filtrerEtAfficherQualicharge);
    if (chkPL) chkPL.addEventListener('change', filtrerEtAfficherQualicharge);
    if (btnExport) btnExport.addEventListener('click', exporterQualichargeExcel);

    if (btnReset) {
        btnReset.addEventListener('click', function() {

            if (!map.hasLayer(osm)) {
        osm.addTo(map);
    }
    if (map.hasLayer(sat)) {
        map.removeLayer(sat);
    }
    osm.setOpacity(1);
    sat.setOpacity(1);

    // Remettre le curseur d'opacité et son libellé à 100%
    const rangeTransparence = document.getElementById('rangeTransparence');
    const valeurTransparence = document.getElementById('valeurTransparence');
    if (rangeTransparence) rangeTransparence.value = '1';
    if (valeurTransparence) valeurTransparence.textContent = '100%';

    // Zoom et centrage initiaux
    map.setView([46.5, 2], 6);	
			
	 const chkTousGvo = document.getElementById('chkGestionnaireTous');
const subListGvo = document.getElementById('subListGestionnaires');

if (chkTousGvo && subListGvo) {
    // 1. Cocher la case "Tous"
    chkTousGvo.checked = true;
    
    // 2. Décocher toutes les sous-cases individuelles
    subListGvo.querySelectorAll('.chk-gvo-item').forEach(chk => {
        chk.checked = false;
    });
    
    // 3. Forcer la mise à jour visuelle et le rafraîchissement des couches
    gererChangementGestionnaires();

    if (typeof mettreAJourCouleurFondFiltre === 'function') {
        mettreAJourCouleurFondFiltre();
    }
    if (typeof mettreAJourTitreGestionnaire === 'function') {
        mettreAJourTitreGestionnaire();
    }
}
			const contentGestionnaire = document.getElementById('content-gvo'); 
const arrowGestionnaire = document.getElementById('arrow-gvo');     // 


const contentAffichage = document.getElementById('affichage-content'); // Remplacez 'content-affichage' par l'ID exact du contenu de votre section Affichage dans le HTML
const arrowAffichage = document.getElementById('arrow-affichage');     // ID de la flèche associée (si applicable)

if (contentAffichage && !contentAffichage.classList.contains('collapsed')) {
    contentAffichage.classList.add('collapsed');
    if (arrowAffichage) {
        arrowAffichage.style.transform = 'rotate(-90deg)'; // Remet la flèche dans l'état replié (vers le bas/gauche selon votre CSS)
    }
}


const contentCouches = document.getElementById('layers-content');
const arrowCouches = document.getElementById('arrow-layers');

if (contentCouches && !contentCouches.classList.contains('collapsed')) {
    contentCouches.classList.add('collapsed');
    if (arrowCouches) {
        arrowCouches.style.transform = 'rotate(-90deg)';
    }
}

if (contentGestionnaire && !contentGestionnaire.classList.contains('collapsed')) {
    contentGestionnaire.classList.add('collapsed');
    if (arrowGestionnaire) {
        arrowGestionnaire.style.transform = 'rotate(-90deg)';
    }
}
			
			
		// 1. Gestion des couches sur la carte (RRN affichées, GESIR masquées)
        if (typeof coucheRRN_C !== 'undefined' && !map.hasLayer(coucheRRN_C)) {
            coucheRRN_C.addTo(map);
        }
        if (typeof coucheRRN_NC !== 'undefined' && !map.hasLayer(coucheRRN_NC)) {
            coucheRRN_NC.addTo(map);
        }
        if (typeof coucheGESIR_C !== 'undefined' && map.hasLayer(coucheGESIR_C)) {
            map.removeLayer(coucheGESIR_C);
        }
        if (typeof coucheGESIR_NC !== 'undefined' && map.hasLayer(coucheGESIR_NC)) {
            map.removeLayer(coucheGESIR_NC);
        }

        // 2. Réinitialisation des icônes et des titres (boutons RRN en mode "œil" / actif)
        const btnToggleRRN_C = document.getElementById('btnToggleRRN_C');
        if (btnToggleRRN_C) {
            btnToggleRRN_C.textContent = "👁️";
            btnToggleRRN_C.title = "Masquer RRN C";
        }

        const btnToggleRRN_NC = document.getElementById('btnToggleRRN_NC');
        if (btnToggleRRN_NC) {
            btnToggleRRN_NC.textContent = "👁️";
            btnToggleRRN_NC.title = "Masquer RRN NC";
        }

        // 3. Réinitialisation des boutons GESIR en mode "croix" / inactif
        const btnToggleGESIR_C = document.getElementById('btnToggleGESIR_C');
        if (btnToggleGESIR_C) {
            btnToggleGESIR_C.textContent = "❌";
            btnToggleGESIR_C.title = "Afficher GESIR C";
        }

        const btnToggleGESIR_NC = document.getElementById('btnToggleGESIR_NC');
        if (btnToggleGESIR_NC) {
            btnToggleGESIR_NC.textContent = "❌";
            btnToggleGESIR_NC.title = "Afficher GESIR NC";
        }

        // 4. Masquer les sous-options / traits associés si nécessaire
        const subOptsC = document.getElementById('subOptions_GESIR_C');
        if (subOptsC) {
            subOptsC.style.display = 'none';
        }

        const subOptsNC = document.getElementById('subOptions_GESIR_NC');
        if (subOptsNC) {
            subOptsNC.style.display = 'none';
        }	
			
		// 5. Décocher toutes les sous-options / cases à cocher des traits
        gesirC_classesMasquees.clear();
        gesirNC_classesMasquees.clear();

        document.querySelectorAll('.gesir-filter-item').forEach(item => {
            const traitDiv = item.querySelector('div');
            if (traitDiv) traitDiv.style.opacity = '1';
            const croix = item.querySelector('.croix-rouge');
            if (croix) croix.remove();
        });


            if (chkQualicharge) chkQualicharge.checked = false;
            if (chkVL) chkVL.checked = true;
            if (chkPL) chkPL.checked = true;
			
			
			// Réinitialisation de la case principale des Aires
            const mainAires = document.getElementById('chkAires');
            if (mainAires) mainAires.checked = false;
            if (divOptionsAires) divOptionsAires.style.display = 'none';
			
			const mainPeages = document.getElementById('chkPeages');
            if (mainPeages) mainPeages.checked = false;
            if (divOptionsPeages) divOptionsPeages.style.display = 'none';
			
			if (typeof coucheCarrefours !== 'undefined') {
    map.removeLayer(coucheCarrefours);
    coucheCarrefours.clearLayers();
}
const chkCarrefoursHTML = document.getElementById('chkFiltrerCarrefours');
if (chkCarrefoursHTML) chkCarrefoursHTML.checked = false;
const divOptCarrefours = document.getElementById('options_Carrefours');
if (divOptCarrefours) divOptCarrefours.style.display = 'none';
			
            if (typeof coucheQualicharge !== 'undefined' && map.hasLayer(coucheQualicharge)) {
                map.removeLayer(coucheQualicharge);
            }

            if (divOptions) divOptions.style.display = 'none';
            if (lblStatut) lblStatut.style.display = 'none';
            
            const legendeVL = document.getElementById('legende_Qualicharge_VL');
            const legendePL = document.getElementById('legende_Qualicharge_PL');
			//const legendeAires = document.getElementById('legende_Qualicharge_Aires'); // <-- INCLUSION RESET
            if (legendeVL) legendeVL.style.display = 'none';
            if (legendePL) legendePL.style.display = 'none';
			//if (legendeAires) legendeAires.style.display = 'none'; // <-- SÉCURITÉ RESET
            
            const legAiresRepos = document.getElementById('legende_AiresRepos');
            const legAiresService = document.getElementById('legende_AiresService');
            const legBPV = document.getElementById('legende_BPV');
            const legEchangeur = document.getElementById('legende_Echangeur');
			
			const legAiresAutre = document.getElementById('legende_AiresAutres');
				if (legAiresAutre) legAiresAutre.style.display = 'none';

            if (legAiresRepos) legAiresRepos.style.display = 'none';
            if (legAiresService) legAiresService.style.display = 'none';
            if (legBPV) legBPV.style.display = 'none';
            if (legEchangeur) legEchangeur.style.display = 'none';
			
			
            
            const divLegendeGlobale = document.getElementById('legende_Qualicharge');
            if (divLegendeGlobale) divLegendeGlobale.style.display = 'none';
        // Réinitialisation de l'état de secours lors du Reset
            estDonneesSecoursQualicharge = false;
			
			// Réinitialisation Échangeurs
			const chkEchangeurs = document.getElementById('chkEchangeurs');
			const chkBifurcation = document.getElementById('chkEch_Bifurcation');
    const chkDiffuseur = document.getElementById('chkEch_Diffuseur');
    const chkMixte = document.getElementById('chkEch_Mixte');
	const divOptionsEch = document.getElementById('options_Echangeurs');
            if (chkEchangeurs) chkEchangeurs.checked = false;
            if (chkBifurcation) chkBifurcation.checked = false;
            if (chkDiffuseur) chkDiffuseur.checked = false;
            if (chkMixte) chkMixte.checked = false;

            if (typeof coucheEchangeurs !== 'undefined' && map.hasLayer(coucheEchangeurs)) {
                map.removeLayer(coucheEchangeurs);
            }
            if (divOptionsEch) divOptionsEch.style.display = 'none';

            const legBif = document.getElementById('legende_Ech_Bifurcation');
            const legDif = document.getElementById('legende_Ech_Diffuseur');
            const legMix = document.getElementById('legende_Ech_Mixte');
            if (legBif) legBif.style.display = 'none';
            if (legDif) legDif.style.display = 'none';
            if (legMix) legMix.style.display = 'none';
        });
    }

    map.on('moveend', function() {
        const chkQualicharge = document.getElementById('chkQualicharge');
        if (chkQualicharge && chkQualicharge.checked) {
            filtrerEtAfficherQualicharge();
        }
    });
	rafraichirAffichageLegende();
}

initialiserEcouteurQualicharge();

function filtrerEtAfficherEchangeurs() {
    if (!map.hasLayer(coucheEchangeurs) || !window.donnees_Echangeurs || !window.donnees_Echangeurs.features) return;

    coucheEchangeurs.clearLayers();

    const chkBifurcation = document.getElementById('chkEch_Bifurcation');
    const chkDiffuseur = document.getElementById('chkEch_Diffuseur');
    const chkMixte = document.getElementById('chkEch_Mixte');

    const affBifurcation = chkBifurcation ? chkBifurcation.checked : true;
    const affDiffuseur = chkDiffuseur ? chkDiffuseur.checked : true;
    const affMixte = chkMixte ? chkMixte.checked : true;

    // Gestion de l'affichage dynamique de la légende
    const legBif = document.getElementById('legende_Ech_Bifurcation');
    const legDif = document.getElementById('legende_Ech_Diffuseur');
    const legMix = document.getElementById('legende_Ech_Mixte');

    if (legBif) legBif.style.display = affBifurcation ? 'flex' : 'none';
    if (legDif) legDif.style.display = affDiffuseur ? 'flex' : 'none';
    if (legMix) legMix.style.display = affMixte ? 'flex' : 'none';

    window.donnees_Echangeurs.features.forEach(f => {
        const props = f.properties;
        const geom = f.geometry;

        if (!geom || !geom.coordinates) return;

        // Extraction de la nature pour le filtrage et l'icône
        const nature = (props.nature || "").trim();
        const natureLower = nature.toLowerCase();

        if (natureLower.includes("bifurcation") && !affBifurcation) {
			rafraichirAffichageLegende();
			mettreAJourLegende();
			return;
		}
        
		if (natureLower.includes("diffuseur") && !affDiffuseur) {
			rafraichirAffichageLegende();
			mettreAJourLegende();
			return;
		}
		
        if (natureLower.includes("mixte") && !affMixte) {
			rafraichirAffichageLegende();
			mettreAJourLegende();
			return;
		}

        // Détermination de l'icône appropriée
        let fichierIcone = "FICHIERS/mixte.png"; // Par défaut
        if (natureLower.includes("bifurcation")) fichierIcone = "FICHIERS/bifurcation.png";
        else if (natureLower.includes("diffuseur")) fichierIcone = "FICHIERS/diffuseur.png";

        // ---- CALCUL DYNAMIQUE DE LA TAILLE INITIALE SELON LE ZOOM ACTUEL ----
const zoomActuelAfficheur = map.getZoom();
let tailleInitiale = 20; //  taille par défaut de départ

if (zoomActuelAfficheur > 8 && zoomActuelAfficheur <= 10) {
    tailleInitiale = 32;
} else if (zoomActuelAfficheur > 10 && zoomActuelAfficheur <= 12) {
    tailleInitiale = 44;
} else if (zoomActuelAfficheur > 12 && zoomActuelAfficheur <= 14) {
    tailleInitiale = 52;
} else if (zoomActuelAfficheur > 14 && zoomActuelAfficheur <= 16) {
    tailleInitiale = 82;
} else if (zoomActuelAfficheur > 16) {
    tailleInitiale = 102;
}

const iconeEchangeur = L.icon({
    iconUrl: fichierIcone,
    iconSize: [tailleInitiale, tailleInitiale], // S'adapte au zoom actuel
    iconAnchor: [tailleInitiale / 2, tailleInitiale / 2], // Reste parfaitement centré
    popupAnchor: [0, -10],
    className: 'icone-echangeur-zoom' // Classe d'identification pour la fonction globale de zoom
});
		
		

        // Lecture des coordonnées (colonne 3 et 4 du geojson -> [lon, lat])
        const lon = parseFloat(geom.coordinates[0]);
        const lat = parseFloat(geom.coordinates[1]);
		const coordsStr = `${lat},${lon}`;

        if (isNaN(lat) || !lon) return;

        // Construction du Popup formaté
        const htmlPopup = `
            <div style="font-family: Arial, sans-serif; font-size: 12px; width: fit-content; line-height: 1.4;">
                <b style="color: #2c3e50; font-size: 13px;">${props.route || 'Inconnue'} - ${props.nom || 'Sans nom'}</b><br><br>
                <b>${props.nature || ''}</b> - <i>${props.forme || ''}</i><br>
                N° : ${props.No || 'Non spécifié'}<br>
                Concession : ${props.concession || 'Non spécifiée'}<br>
                Nombre de bretelles : ${props.nbBretelle || '0'}<br><br>
                <span style="color: #555; font-style: italic;">${props.sectionn_1 || ''}</span><br><br>
                <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/StreetView.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Street View"> StreetView</a><br><a href="https://www.google.com/maps/search/?api=1&query=${lat},${lon}&basemap=roadmap" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Maps.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Maps"> Maps</a><br><a href="https://earth.google.com/web/@${lat},${lon},100a,350d,35y,0h,0t,0r" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Earth.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Earth"> Earth</a>
            </div>
        `;

        const marqueur = L.marker([lat, lon], { icon: iconeEchangeur }).bindPopup(htmlPopup);
        coucheEchangeurs.addLayer(marqueur);
    });
	
	rafraichirAffichageLegende();
	mettreAJourLegende();
	
}

function chargerDonneesEchangeurs() {
    if (map.hasLayer(coucheEchangeurs)) return;
    coucheEchangeurs.addTo(map);
	actualiserTailleIcones();

    const divOptions = document.getElementById('options_Echangeurs');
    const divLegendeGlobale = document.getElementById('legende_Qualicharge'); // Utilisation du conteneur parent de légende existant

    if (divOptions) divOptions.style.display = 'flex';
    //if (divLegendeGlobale) divLegendeGlobale.style.display = 'flex';

    filtrerEtAfficherEchangeurs();
}

function initialiserEcouteurEchangeurs() {
const chkEchangeurs = document.getElementById('chkEchangeurs');
    const chkBifurcation = document.getElementById('chkEch_Bifurcation');
    const chkDiffuseur = document.getElementById('chkEch_Diffuseur');
    const chkMixte = document.getElementById('chkEch_Mixte');
    const divOptionsEch = document.getElementById('options_Echangeurs');

    if (chkEchangeurs) {
        chkEchangeurs.addEventListener('change', function(e) {
            if (e.target.checked) {
				
				if (chkBifurcation) chkBifurcation.checked = true;
				if (chkDiffuseur) chkDiffuseur.checked = true;
				if (chkMixte) chkMixte.checked = true;
                chargerDonneesEchangeurs();
				rafraichirAffichageLegende();
				mettreAJourLegende();
            } else {
                map.removeLayer(coucheEchangeurs);
                if (divOptionsEch) divOptionsEch.style.display = 'none';
				
				if (chkBifurcation) chkBifurcation.checked = false;
				if (chkDiffuseur) chkDiffuseur.checked = false;
				if (chkMixte) chkMixte.checked = false;
				
                
                const legBif = document.getElementById('legende_Ech_Bifurcation');
                const legDif = document.getElementById('legende_Ech_Diffuseur');
                const legMix = document.getElementById('legende_Ech_Mixte');
                if (legBif) legBif.style.display = 'none';
                if (legDif) legDif.style.display = 'none';
                if (legMix) legMix.style.display = 'none';
				rafraichirAffichageLegende();
				mettreAJourLegende();
            }
        });
    }

    if (chkBifurcation) chkBifurcation.addEventListener('change', filtrerEtAfficherEchangeurs);
    if (chkDiffuseur) chkDiffuseur.addEventListener('change', filtrerEtAfficherEchangeurs);
    if (chkMixte) chkMixte.addEventListener('change', filtrerEtAfficherEchangeurs);
	
	mettreAJourLegende();

    // Synchronisation avec l'événement de déplacement de carte existant
    map.on('moveend', function() {
        if (chkEchangeurs && chkEchangeurs.checked) {
            filtrerEtAfficherEchangeurs();
        }
    });

rafraichirAffichageLegende();
}	
	


initialiserEcouteurEchangeurs();


// États globaux de masquage
let bornesRougesMasquees = false;


function rafraichirVisibiliteBornes() {
    // 1. Gestion des bornes ROUGES (Issues du tracé)
    const marqueursRouges = document.querySelectorAll('.borne-rouge-marker');
    marqueursRouges.forEach(marker => {
        marker.style.visibility = bornesRougesMasquees ? 'hidden' : 'visible';
    });

    // 2. Gestion des bornes ORANGES (Issues du clic carte)
    const marqueursOranges = document.querySelectorAll('.borne-orange-marker');
    marqueursOranges.forEach(marker => {
        marker.style.visibility = bornesOrangesMasquees ? 'hidden' : 'visible';
    });
	
	const marqueurDepart = document.querySelectorAll('.MarkerVert');
    marqueurDepart.forEach(marker => {
        marker.style.visibility = MarkVertMasque ? 'hidden' : 'visible';
    });
	
	const marqueurFin = document.querySelectorAll('.MarkerRouge');
    marqueurFin.forEach(marker => {
        marker.style.visibility = MarkRougeMasque ? 'hidden' : 'visible';
    });
	
	const marqueurRecherche = document.querySelectorAll('.MarkerBleu');
    marqueurRecherche.forEach(marker => {
        marker.style.visibility = MarkBleuMasque ? 'hidden' : 'visible';
    });
}




document.addEventListener("DOMContentLoaded", () => {
    const btnMasquerRouge = document.getElementById('btnMasquerRouge');
    const barreRouge = document.getElementById('barreRouge');
    const btnMasquerOrange = document.getElementById('btnMasquerOrange');
    const barreOrange = document.getElementById('barreOrange');
	
	const btnMasquerMarkVert = document.getElementById('btnMasquerMarkVert');
    const barreMarkVert = document.getElementById('barreMarkVert');
	
	const btnMasquerMarkRouge = document.getElementById('btnMasquerMarkRouge');
    const barreMarkRouge = document.getElementById('barreMarkRouge');
	
	//const btnMasquerMarkBleu = document.getElementById('btnMasquerMarkBleu');
    const btnMasquerMarkBleu = e.target.closest('#btnMasquerMarkBleu');

    const barreMarkBleu = document.getElementById('barreMarkBleu');

    if (btnMasquerRouge) {
        btnMasquerRouge.addEventListener('click', function(e) {
            e.stopPropagation();
            bornesRougesMasquees = !bornesRougesMasquees;
            if (barreRouge) barreRouge.style.display = bornesRougesMasquees ? 'block' : 'none';
            rafraichirVisibiliteBornes();
        });
    }

    if (btnMasquerOrange) {
        btnMasquerOrange.addEventListener('click', function(e) {
            e.stopPropagation();
            bornesOrangesMasquees = !bornesOrangesMasquees;
            if (barreOrange) barreOrange.style.display = bornesOrangesMasquees ? 'block' : 'none';
            rafraichirVisibiliteBornes();
        });
    }
	
	if (btnMasquerMarkVert) {
        btnMasquerMarkVert.addEventListener('click', function(e) {
            e.stopPropagation();
            MarkVertMasque = !MarkVertMasque;
            if (barreMarkVert) barreMarkVert.style.display = MarkVertMasque ? 'block' : 'none';
            rafraichirVisibiliteBornes();
        });
    }
	
	if (btnMasquerMarkRouge) {
        btnMasquerMarkRouge.addEventListener('click', function(e) {
            e.stopPropagation();
            MarkRougeMasque = !MarkRougeMasque;
            if (barreMarkRouge) barreMarkRouge.style.display = MarkRougeMasque ? 'block' : 'none';
            rafraichirVisibiliteBornes();
        });
    }
	
	//if (btnMasquerMarkBleu) {
    //    btnMasquerMarkBleu.addEventListener('click', function(e) {
    //        e.stopPropagation();
    //        MarkBleuMasque = !MarkBleuMasque;
    //        if (barreMarkBleu) barreMarkBleu.style.display = MarkBleuMasque ? 'block' : 'none';
   //         rafraichirVisibiliteBornes();
    //    });
    //}

if (btnMasquerMarkBleu) {
		MarkBleuMasque = !MarkBleuMasque;
		const barreMarkBleu = document.getElementById('barreMarkBleu');
		if (barreMarkBleu) barreMarkBleu.style.display = MarkBleuMasque ? 'block' : 'none';
        
        // Masque ou affiche tous les marqueurs bleus stockés (provenant de "Voir sur la carte", etc.)
        blueMarkers.forEach(m => {
            if (MarkBleuMasque) map.removeLayer(m);
            else m.addTo(map);
        });

        // Masque ou affiche également le marqueur de recherche s'il existe
        if (typeof searchMarker !== 'undefined' && searchMarker) {
            if (MarkBleuMasque) map.removeLayer(searchMarker);
            else searchMarker.addTo(searchMarker); // ou searchMarker.addTo(map) selon votre implémentation de recherche
        }
        
        // (Suppression de clicMarkers ici, car ce sont les bornes oranges gérées par le bouton orange)
	}



    // Ré-appliquer le filtre dès que Leaflet rafraîchit la carte (Zoom, Déplacement ou Nouveau tracé)
    if (typeof map !== 'undefined') {
        map.on('layeradd', function() {
            setTimeout(rafraichirVisibiliteBornes, 10);
        });
    }

    // Intégration lors du clic sur le bouton Reset
    const btnReset = document.getElementById('btnReset');
    if (btnReset) {
        btnReset.addEventListener('click', function() {
            bornesRougesMasquees = false;
            bornesOrangesMasquees = false;
			MarkVertMasque = false;
			MarkRougeMasque = false;
			MarkBleuMasque = false;
			
            if (barreRouge) barreRouge.style.display = 'none';
            if (barreOrange) barreOrange.style.display = 'none';
			if (barreMarkVert) barreMarkVert.style.display = 'none';
			if (barreMarkRouge) barreMarkRouge.style.display = 'none';
			if (barreMarkBleu) barreMarkBleu.style.display = 'none';
			
			
            
            // Masquage existant du cadastre et fermeture des popups
            const chkCadastre = document.getElementById('chkCadastre');
            if (chkCadastre) chkCadastre.checked = false;
            if (window.coucheCadastre && map.hasLayer(window.coucheCadastre)) map.removeLayer(window.coucheCadastre);
            if (window.contourParcelleSelectionnee) {
                map.removeLayer(window.contourParcelleSelectionnee);
                window.contourParcelleSelectionnee = null;
            }
            map.closePopup();

            setTimeout(rafraichirVisibiliteBornes, 10);
        });
    }
});

// --- GESTION DE LA DISPOSITION DE LA LÉGENDE (MASQUAGE & 2 COLONNES) ---
 
 
function rafraichirAffichageLegende() {
    const legendeBlock = document.getElementById('legende');
    if (!legendeBlock) return;

    // 1. Gestion de la visibilité spécifique de la légende Carrefours
    const legendeCarrefours = document.getElementById('legende_Qualicharge_Carrefour');
    if (legendeCarrefours) {
        const chkFiltrerCarrefours = document.getElementById('chkFiltrerCarrefours');
        const afficherCarrefours = (typeof map !== 'undefined' && typeof coucheCarrefours !== 'undefined' && map.hasLayer(coucheCarrefours) && chkFiltrerCarrefours && chkFiltrerCarrefours.checked);
        legendeCarrefours.style.display = afficherCarrefours ? 'flex' : 'none';
    }

    // Liste complète de tous les éléments de légende issus du HTML
    const items = [
        document.getElementById('legende_AiresRepos'),
        document.getElementById('legende_AiresService'),
		document.getElementById('legende_AiresAutres'),
        document.getElementById('legende_BPV'),
        document.getElementById('legende_Echangeur'),
        document.getElementById('legende_Qualicharge_VL'),
        document.getElementById('legende_Qualicharge_PL'),
		document.getElementById('legende_Qualicharge_AireC'),
		document.getElementById('legende_Qualicharge_AireNC'),
		document.getElementById('legende_Qualicharge_Carrefour'),
        document.getElementById('legende_Qualicharge_Aires'),
        document.getElementById('legende_Ech_Bifurcation'),
        document.getElementById('legende_Ech_Diffuseur'),
        document.getElementById('legende_Ech_Mixte')
    ];

    // 2. Nettoyage préalable des règles inline 'important' qui bloquent le masquage
    // et comptage des éléments réellement voulus comme visibles (style.display !== 'none')
    let itemsVisibles = [];

    items.forEach(item => {
        if (item) {
            // Si l'élément a été explicitement masqué ('none'), on ne le touche pas.
            // Sinon, on retire la priorité 'important' pour laisser le flux CSS naturel opérer.
            if (item.style.display === 'none') {
                // Il est masqué, RAS
            } else {
                // On vérifie le style calculé
                const displayReel = window.getComputedStyle(item).display;
                if (displayReel !== 'none') {
                    itemsVisibles.push(item);
                }
            }
        }
    });

    const nbVisibles = itemsVisibles.length;

    // 3. Application de la structure Flexbox selon le quota réel d'éléments
    if (nbVisibles > 0) {
        legendeBlock.style.display = 'flex';
        legendeBlock.style.alignItems = 'flex-start'; // <--- FORCE L'ALIGNEMENT À GAUCHE DE TOUT LE MONDE
        legendeBlock.style.justifyContent = 'flex-start';
        const titre = legendeBlock.querySelector('b');

        if (nbVisibles >= 3) {
            // --- MODE 2 COLONNES AVEC CSS GRID CLEAN ---
            legendeBlock.style.display = 'grid';
            legendeBlock.style.gridTemplateColumns = 'repeat(2, 1fr)';
            legendeBlock.style.gridAutoFlow = 'row'; // Placement séquentiel ligne par ligne
            legendeBlock.style.gap = '6px 10px';
            legendeBlock.style.width = '300px'; 
            legendeBlock.style.alignItems = 'center';

            if (titre) {
                titre.style.gridColumn = '1 / -1'; // Le titre s'étale de la col 1 à la dernière col
                titre.style.textAlign = 'center';
            }

            itemsVisibles.forEach(item => {
                item.style.display = 'flex';
                item.style.alignItems = 'center';
                item.style.justifyContent = 'flex-start';
                item.style.gridColumn = 'auto'; // FIX : Force le placement automatique dans la grille (annule tout grid-column hérité)
                item.style.width = '100%';
                item.style.boxSizing = 'border-box';
            });
        } else {
            // --- MODE COLONNE UNIQUE (1 ou 2 éléments max) ---
            //legendeBlock.style.display = 'flex';
            legendeBlock.style.flexDirection = 'column';
            legendeBlock.style.gap = '6px';
            legendeBlock.style.width = 'max-content';

            if (titre) {
                titre.style.width = '100%';
                titre.style.textAlign = 'center'; // Pour garder le titre "Légende" centré en haut
            }

            itemsVisibles.forEach(item => {
                item.style.display = 'flex'; // Sans !important
				item.style.alignItems = 'center';
                item.style.justifyContent = 'flex-start';
                item.style.width = '100%';
            });
        }
    } else {
        // Aucun élément visible -> On cache le conteneur complet
        legendeBlock.style.display = 'none';
    }
}

    // Liaison automatique : Écouter tous les changements sur l'ensemble des cases à cocher
    const listeIdInputs = [
        'chkAires', 'chkAiresC', 'chkAiresNC',
        'chkPeages', 'chkPeagesBPV', 'chkPeagesEch',
        'chkEchangeurs', 'chkEchGare', 'chkEchDif', 'chkEchMixte',
        'chkQualicharge', 'chkAfficher_Aires_C', 'chkAfficher_Aires_NC'
    ];
    
    listeIdInputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('change', () => {
                // Un léger délai permet aux fonctions d'origine de modifier d'abord les style.display
                setTimeout(rafraichirAffichageLegende, 15);
            });
        }
    });

    // Liaison au clic sur le bouton Reset
    const boutonResetPage = document.getElementById('btnReset');
    if (boutonResetPage) {
        boutonResetPage.addEventListener('click', () => {
            setTimeout(rafraichirAffichageLegende, 25);
        });
    }


// RRN
/* ---------------- COUCHES DE POLYLIGNES RRN (C ET NC) AVEC CONVERSION MAISON ---------------- */

// 1. fonction de conversion interne Lambert 93 vers WGS84
function lambert93ToWGS84_RRN(x, y) {
    const c = 11754255.426; // constante de projection
    const x0 = 700000.0;
    const y0 = 12655612.049;
    const n = 0.725607765053267;
    const e = 0.0818191910428158; // excentricité première
    const e2 = e * e;

    const dx = x - x0;
    const dy = y - y0;
    const r = Math.sqrt(dx * dx + dy * dy);
    const gamma = Math.atan(dx / -dy);

    const latIso = -1 / n * Math.log(Math.abs(r / c));
    
    // Calcul de la latitude par itérations successives
    let phi = 2 * Math.atan(Math.exp(latIso)) - Math.PI / 2;
    let phiPrecedent = 0;
    let p = 0;
    
    while (Math.abs(phi - phiPrecedent) > 1e-11 && p < 100) {
        phiPrecedent = phi;
        const sinPhi = Math.sin(phi);
        const esinPhi = e * sinPhi;
        phi = 2 * Math.atan(Math.pow((1 + esinPhi) / (1 - esinPhi), e / 2) * Math.exp(latIso)) - Math.PI / 2;
        p++;
    }

    const lon = (gamma / n) * (180 / Math.PI) + 3; // +3 pour le méridien de Paris en Lambert93
    const lat = phi * (180 / Math.PI);

    return { lat: lat, lon: lon };
}

// Fonction de style pour les arcs GESIR selon 'classifica'
function styleArcGESIR(feature) {
    const props = feature.properties || {};
    
    // Récupération sécurisée en vérifiant les différentes casses possibles
    const classifica = props['Classifica'] !== undefined ? props['Classifica'] : 
                       (props['classifica'] !== undefined ? props['classifica'] : null);
    
    let couleur = "#000000"; // Noir par défaut (0 ou vide)
    
    // Conversion en chaîne ou nombre pour une comparaison robuste
    const val = String(classifica).trim();

    if (val === "1" || val === 1) couleur = "#014701";       // Vert foncé
    else if (val === "2" || val === 2) couleur = "#2cf52c"; // Vert clair
    else if (val === "3" || val === 3) couleur = "#f1c40f"; // Jaune
    else if (val === "4" || val === 4) couleur = "#e67e22"; // Orange
    else if (val === "5" || val === 5) couleur = "#f50000"; // Rouge

    return {
        color: couleur,
        weight: 3.5,
        opacity: 0.9
    };
}


// Configuration du popup pour les couches GESIR avec bouton de fermeture ⛔ en haut
// Configuration du popup et de la surépaisseur de l'arc pour les couches GESIR
function configurerPopupGESIR(feature, layer) {
    // Sauvegarde de l'épaisseur initiale de l'arc
    const styleInitial = styleArcGESIR(feature);
    const poidsInitial = styleInitial.weight || 3.5;
    const poidsSelectionne = poidsInitial * 3;

    const props = feature.properties || {};
    const nomRoute = props['Nom Route'] || props['nom_route'] || 'Inconnu';
    const longKm = props['long_km'] !== undefined ? props['long_km'] : 'N/A';
    const gvo = props['GVO'] || props['gvo'] || 'N/A';
    const od = props['OD'] || props['od'] || 'N/A';
    const classifica = props['Classifica'] || props['classifica'] || 'N/A';

    // Création de l'élément popup localement
    const divPopup = document.createElement('div');
    divPopup.style.textAlign = 'left';
    divPopup.style.minWidth = '200px';
    divPopup.style.position = 'relative';
    divPopup.style.paddingTop = '15px';

    

    const contenuTexte = document.createElement('div');
    contenuTexte.innerHTML = `
        <b>Axe :</b> ${nomRoute}<br>
        <b>Longueur :</b> ${longKm} km<br>
        <b>GVO :</b> ${gvo}<br>
        <b>Localisation :</b> ${od}<br>
        <b>Classement :</b> ${classifica}<br>
    `;

    
    divPopup.appendChild(contenuTexte);

    // Association de la popup à la couche une seule fois
    layer.bindPopup(divPopup);

    // Événement d'ouverture du popup : double l'épaisseur de l'arc
    layer.on('popupopen', function() {
        layer.setStyle({ weight: poidsSelectionne });
    });

    // Événement de fermeture du popup : rétablit l'épaisseur initiale
    layer.on('popupclose', function() {
        layer.setStyle({ weight: poidsInitial });
    });
}


// 3. Fonction de création du popup lors du clic sur un segment de ligne
function configurerPopupRRN(feature, layer) {
    layer.on('click', function(e) {
        // Coordonnées du clic précis sur la ligne
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
		const coordsStr = `${lat},${lng}`;
        
        const props = feature.properties || {};
        const libRte = props['lib_rte'] || 'Route inconnue';
        const gestionnaire = props['gestionnai'] || 'Gestionnaire inconnu';
        
        // Lien Street View calqué sur le point cliqué
        const urlStreetView = `"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/StreetView.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Street View"> StreetView</a><br><a href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}&basemap=roadmap" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Maps.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Maps"> Maps</a><br><a href="https://earth.google.com/web/@${lat},${lng},100a,350d,35y,0h,0t,0r" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Earth.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Earth"> Earth`;
        
        const contenuPopup = `
            <div style="font-family: Arial, sans-serif; font-size: 12px; line-height: 1.4; text-align: left;">
                <b>${libRte}</b> - ${gestionnaire}<br>
                <div style="margin-top: 5px;">
                    <a href=${urlStreetView} 
                    </a>
                </div>
            </div>
        `;
        
        layer.bindPopup(contenuPopup).openPopup();
    });
}

// 4. Initialisation automatique au chargement du DOM
document.addEventListener("DOMContentLoaded", function() {
    
    // Configuration de l'option de conversion pour les objets linéaires (MultiLineString / LineString)
    const optionsGeoJSONRRN = {
        coordsToLatLng: function(coords) {
            let lat, lon;
            // Si la coordonnée X > 180, on applique la formule Lambert 93
            if (Math.abs(coords[0]) > 180) {
                const conversion = lambert93ToWGS84_RRN(coords[0], coords[1]);
                lat = conversion.lat;
                lon = conversion.lon;
            } else {
                lat = coords[1];
                lon = coords[0];
            }
            return L.latLng(lat, lon);
        },
        onEachFeature: configurerPopupRRN
    };

    // Chargement et conversion de RRN_C (en bleu)
    
if (typeof donneesRRN_C !== 'undefined') {
    // Cette ligne convertit instantanément le TopoJSON ultra-léger en GeoJSON compréhensible par Leaflet
    const geojsonConverti = topojson.feature(donneesRRN_C, donneesRRN_C.objects.RRN_C); 

    L.geoJSON(geojsonConverti, {
        ...optionsGeoJSONRRN,
        style: { color: "blue", weight: 3 }
    }).addTo(coucheRRN_C);
	
	coucheRRN_C.addTo(map);
	actualiserTailleIcones();
}

    // Chargement et conversion de RRN_NC (en vert)
    
if (typeof donneesRRN_NC !== 'undefined') {
    // Cette ligne convertit instantanément le TopoJSON ultra-léger en GeoJSON compréhensible par Leaflet
    const geojsonConverti = topojson.feature(donneesRRN_NC, donneesRRN_NC.objects.RRN_NC); 

    L.geoJSON(geojsonConverti, {
        ...optionsGeoJSONRRN,
        style: { color: "green", weight: 3 }
    }).addTo(coucheRRN_NC);
	coucheRRN_NC.addTo(map);
	actualiserTailleIcones();
}

mettreAJourLongueurReseauAffiche();



if (typeof donneesGESIR26_C !== 'undefined') {
        const geojsonGESIR_C = topojson.feature(donneesGESIR26_C, donneesGESIR26_C.objects.GESIR26_RRN_C || Object.keys(donneesGESIR26_C.objects)[0]);
        L.geoJSON(geojsonGESIR_C, {
            ...optionsGeoJSONRRN,
            style: styleArcGESIR,
            onEachFeature: configurerPopupGESIR
        }).addTo(coucheGESIR_C);
    }

    // 4. Chargement GESIR26_RRN_NC (Masquée par défaut)
    if (typeof donneesGESIR26_NC !== 'undefined') {
        const geojsonGESIR_NC = topojson.feature(donneesGESIR26_NC, donneesGESIR26_NC.objects.GESIR26_RRN_NC || Object.keys(donneesGESIR26_NC.objects)[0]);
        L.geoJSON(geojsonGESIR_NC, {
            ...optionsGeoJSONRRN,
            style: styleArcGESIR,
            onEachFeature: configurerPopupGESIR
        }).addTo(coucheGESIR_NC);
    }


  
});


//opacité
document.addEventListener("DOMContentLoaded", function() {
    // Petit délai pour laisser Leaflet instancier son contrôle des calques
    setTimeout(function() {
        const conteneurLayers = document.querySelector('.leaflet-control-layers-list');
        
        if (conteneurLayers) {
            // Création d'un bloc dédié pour le curseur de transparence
            const divTransparence = document.createElement('div');
            divTransparence.style.marginTop = '8px';
            divTransparence.style.paddingTop = '6px';
            divTransparence.style.borderTop = '1px solid #ddd';
            divTransparence.style.fontSize = '11px';
            divTransparence.style.color = '#2c3e50';
            
            divTransparence.innerHTML = `
                <style>
                    #rangeTransparence {
                        -webkit-appearance: none;
                        width: 100%;
                        height: 4px; /* Épaisseur fine de la barre */
                        background: #cbd5e1;
                        border-radius: 2px;
                        outline: none;
                        margin: 4px 0 2px 0;
                    }
                    #rangeTransparence::-webkit-slider-thumb {
                        -webkit-appearance: none;
                        width: 12px;
                        height: 12px;
                        border-radius: 50%;
                        background: #34495e;
                        cursor: pointer;
                    }
                    #rangeTransparence::-moz-range-thumb {
                        width: 12px;
                        height: 12px;
                        border-radius: 50%;
                        background: #34495e;
                        cursor: pointer;
                        border: none;
                    }
                </style>
                <label for="rangeTransparence" style="display: block; font-weight: bold; margin-bottom: 2px;">
                    Opacité : <span id="valeurTransparence">100%</span>
                </label>
                <input type="range" id="rangeTransparence" min="0.1" max="1" step="0.05" value="1">
            `;
            
            conteneurLayers.appendChild(divTransparence);

            // Gestion de l'événement du curseur
            const rangeInput = document.getElementById('rangeTransparence');
            const spanValeur = document.getElementById('valeurTransparence');

            rangeInput.addEventListener('input', function() {
                const opacite = parseFloat(this.value);
                spanValeur.textContent = Math.round(opacite * 100) + '%';

                // Applique l'opacité au calque actif sur la carte
                if (osm && map.hasLayer(osm)) {
                    osm.setOpacity(opacite);
                }
                if (sat && map.hasLayer(sat)) {
                    sat.setOpacity(opacite);
                }
            });
        }
    }, 200);
});






//Aires qualicharge
/* ---------------- CODE DE CALCUL, EXPORT ET VISUALISATION DES STATIONS SUR AIRES ---------------- */

let coucheStationsAires = L.layerGroup();

// 1. Algorithme Point-in-Polygon (Ray-casting)
function isPointInPolygon(point, polygon) {
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];
        
        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// 2. Vérification sur le GeoJSON (Retourne la Feature correspondante si trouvé, sinon null)
function findFeatureContainingPoint(coords, geojson) {
    if (!geojson || !geojson.features) return null;
    const pt = [coords[1], coords[0]]; // [Longitude, Latitude]

    for (const feature of geojson.features) {
        if (!feature.geometry) continue;
        const type = feature.geometry.type;
        const rings = feature.geometry.coordinates;

        if (type === "Polygon") {
            if (isPointInPolygon(pt, rings[0])) return feature;
        } else if (type === "MultiPolygon") {
            for (const polygon of rings) {
                if (polygon && polygon[0] && isPointInPolygon(pt, polygon[0])) return feature;
            }
        }
    }
    return null;
}

// Fonction centrale de traitement (avec filtres optionnels pour l'affichage cartographique)
function traiterStationsSurAires(afficherC = true, afficherNC = true) {
    if (typeof baseQualichargeTraitee === 'undefined' || !baseQualichargeTraitee || baseQualichargeTraitee.length === 0) {
        return null;
    }

    let stats = {
        airesC: {
            total: { stationsVL: 0, pdcVL: 0, stationsPL: 0, pdcPL: 0 },
            service: { stationsVL: 0, pdcVL: 0, stationsPL: 0, pdcPL: 0 },
            repos: { stationsVL: 0, pdcVL: 0, stationsPL: 0, pdcPL: 0 },
            autres: { stationsVL: 0, pdcVL: 0, stationsPL: 0, pdcPL: 0 }
        },
        airesNC: {
            total: { stationsVL: 0, pdcVL: 0, stationsPL: 0, pdcPL: 0 },
            service: { stationsVL: 0, pdcVL: 0, stationsPL: 0, pdcPL: 0 },
            repos: { stationsVL: 0, pdcVL: 0, stationsPL: 0, pdcPL: 0 },
            autres: { stationsVL: 0, pdcVL: 0, stationsPL: 0, pdcPL: 0 }
        }
    };

    let stationsTrouveesPourExcel = [];
    coucheStationsAires.clearLayers(); 

    // Pour éviter de doubler les marqueurs sur un même point géo
    let positionsTraiteesSurCarte = new Set();

    baseQualichargeTraitee.forEach(borne => {
        const lat = parseFloat(borne.a);
        const lon = parseFloat(borne.o);
        if (isNaN(lat) || isNaN(lon)) return;

        const coords = [lat, lon];
        const featureC = (typeof donnees_Aires_C !== 'undefined') ? findFeatureContainingPoint(coords, donnees_Aires_C) : null;
        const featureNC = (typeof donnees_Aires_NC !== 'undefined') ? findFeatureContainingPoint(coords, donnees_Aires_NC) : null;

        if (featureC || featureNC) {
            const estConcede = !!featureC;
            const featureAire = featureC || featureNC;
            const typeAireLabel = estConcede ? "Aires_C" : "Aires_NC";
            
            const nomAireGeo = featureAire.properties.NomUsuel || "Nom inconnu";
            const natureCode = featureAire.properties.Nature || ""; 
            
            let natureLabel = "Autre aire";
            if (natureCode === "S") natureLabel = "Aire de service";
            if (natureCode === "R") natureLabel = "Aire de repos";

            // 1. Accumulation globale (toujours exécutée pour que les stats Excel/Bouton restent justes)
            borne.s.forEach(subStation => {
                const pointsDeCharge = parseInt(subStation.p, 10) || 0;
                const estPL = subStation.t === "PL";
                
                const blocPrincipal = estConcede ? stats.airesC : stats.airesNC;

                if (estPL) {
                    blocPrincipal.total.stationsPL++;
                    blocPrincipal.total.pdcPL += pointsDeCharge;
                } else {
                    blocPrincipal.total.stationsVL++;
                    blocPrincipal.total.pdcVL += pointsDeCharge;
                }

                if (natureCode === "S") {
                    if (estPL) { blocPrincipal.service.stationsPL++; blocPrincipal.service.pdcPL += pointsDeCharge; }
                    else { blocPrincipal.service.stationsVL++; blocPrincipal.service.pdcVL += pointsDeCharge; }
                } else if (natureCode === "R") {
                    if (estPL) { blocPrincipal.repos.stationsPL++; blocPrincipal.repos.pdcPL += pointsDeCharge; }
                    else { blocPrincipal.repos.stationsVL++; blocPrincipal.repos.pdcVL += pointsDeCharge; }
                } else {
                    if (estPL) { blocPrincipal.autres.stationsPL++; blocPrincipal.autres.pdcPL += pointsDeCharge; }
                    else { blocPrincipal.autres.stationsVL++; blocPrincipal.autres.pdcVL += pointsDeCharge; }
                }

                stationsTrouveesPourExcel.push({
                    "Type d'Aire": typeAireLabel,
                    "Nom de l'Aire": nomAireGeo,
                    "Nature de l'Aire": natureLabel,
                    "Code Nature": natureCode,
                    "Nom de la Station Qualicharge": subStation.n,
                    "Opérateur": subStation.m,
                    "Aménageur": subStation.am,
                    "Type Véhicule": subStation.t,
                    "Nombre de PDC": pointsDeCharge,
                    "Configuration Puissances": subStation.u,
                    "Latitude": lat,
                    "Longitude": lon
                });
            });

            // 2. FILTRE D'AFFICHAGE CARTOGRAPHIQUE : On bloque le dessin si la sous-case est décochée
            if (estConcede && !afficherC) return;
            if (!estConcede && !afficherNC) return;

            // 3. Dessin du marqueur unique
            const ClefPosition = `${lat}_${lon}`;
            if (!positionsTraiteesSurCarte.has(ClefPosition)) {
                positionsTraiteesSurCarte.add(ClefPosition);

                let toutesLesSousStationsDuPoint = [];
                baseQualichargeTraitee.forEach(b => {
                    if (b.a === borne.a && b.o === borne.o) {
                        toutesLesSousStationsDuPoint = toutesLesSousStationsDuPoint.concat(b.s);
                    }
                });

                let htmlPopup = `
                    <div style="font-family: Arial, sans-serif; max-width: 550px;">
                        <h4 style="margin: 0 0 4px 0; color: #2c3e50; font-size: 13px;">
                            📍 ${typeAireLabel} — ${nomAireGeo} (${natureLabel})
                        </h4>
                        <div style="font-size: 10px; color: #7f8c8d; margin-bottom: 8px;">Coordonnées : [${borne.a}, ${borne.o}]</div>
                        <div style="overflow-x: auto;">
                            <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: left;">
                                <thead>
                                    <tr style="background-color: #f2f2f2; border-bottom: 1px solid #ddd;">
                                        <th style="padding: 6px; font-weight: bold;">Nom de la Station</th>
                                        <th style="padding: 6px; font-weight: bold;">Opérateur</th>
                                        <th style="padding: 6px; font-weight: bold;">Aménageur</th>
                                        <th style="padding: 6px; font-weight: bold; text-align: center;">Usage</th>
                                        <th style="padding: 6px; font-weight: bold; text-align: center;">PDC</th>
                                        <th style="padding: 6px; font-weight: bold;">Puissances (kW)</th>
                                    </tr>
                                </thead>
                                <tbody>
                `;

                toutesLesSousStationsDuPoint.forEach((sub, index) => {
                    const bgRow = index % 2 === 0 ? "#ffffff" : "#f9f9f9";
                    const badgeColor = sub.t === "PL" ? "#e74c3c" : "#0078ff";
                    
                    htmlPopup += `
                        <tr style="background-color: ${bgRow}; border-bottom: 1px solid #eee;">
                            <td style="padding: 6px; font-weight: bold; color: #333;">${sub.n}</td>
                            <td style="padding: 6px; color: #555;">${sub.m}</td>
                            <td style="padding: 6px; color: #555;">${sub.am}</td>
                            <td style="padding: 6px; text-align: center;">
                                <span style="background-color: ${badgeColor}; color: white; padding: 2px 6px; border-radius: 3px; font-size: 9px; font-weight: bold;">
                                    ${sub.t}
                                </span>
                            </td>
                            <td style="padding: 6px; text-align: center; font-weight: bold; color: #2c3e50;">${sub.p}</td>
                            <td style="padding: 6px; color: #27ae60; font-weight: bold;">${sub.u}</td>
                        </tr>
                    `;
                });



				const coordsStr = `${borne.a},${borne.o}`;
				const lienStreetView = `<a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${borne.a},${borne.o}" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/StreetView.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Street View"> StreetView</a>  <a href="https://www.google.com/maps/search/?api=1&query=${borne.a},${borne.o}&basemap=roadmap" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Maps.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Maps"> Maps</a>  <a href="https://earth.google.com/web/@${borne.a},${borne.o},100a,350d,35y,0h,0t,0r" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Earth.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Earth"> Earth</a>`;
               // const lienStreetView = `<a href="http://maps.google.com/maps?q=&layer=c&cbll=${borne.a},${borne.o}" target="_blank" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/StreetView.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Street View"> Street View</a>`;
                const boutonTrouverAxe = `<button onclick="window.rechercherAxeLePlusProcheQualicharge(${borne.a}, ${borne.o}, this)" style="padding: 4px 8px; font-size: 10px; background-color: #34495e; color: white; border: none; border-radius: 3px; cursor: pointer;">🔍 Identifier l'Axe routier</button>`;

                htmlPopup += `
                                </tbody>
                            </table>
                        </div>
                        <div style="margin-top: 12px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #ddd; padding-top: 8px;">
                            ${boutonTrouverAxe}
                            ${lienStreetView}
                        </div>
                    </div>
                `;

                const couleurMarqueur = estConcede ? '#3498db' : '#2ecc71'; 

                const marqueur = L.circleMarker([borne.a, borne.o], {
                    radius: 7,
                    fillColor: couleurMarqueur,
                    color: "#ffffff",
                    weight: 1.5,
                    opacity: 1,
                    fillOpacity: 0.9
                }).bindPopup(htmlPopup, { maxWidth: 600 });

                coucheStationsAires.addLayer(marqueur);
            }
        }
    });

    return { stats, stationsTrouveesPourExcel };
}

// 3. Écouteur Bouton Résumé Stats Aires (Converti en Modale HTML Flottante avec structure d'origine)
const btnStatsAires = document.getElementById('btnStatsAires');
if (btnStatsAires) {
    btnStatsAires.addEventListener('click', function() {
        const resultat = traiterStationsSurAires(true, true);
        if (!resultat) {
            alert("Aucune donnée Qualicharge n'est disponible ou chargée.");
            return;
        }

        const { stats, stationsTrouveesPourExcel } = resultat;
        window.derniereDonneesAiresExcel = stationsTrouveesPourExcel;

        // Préparation et nettoyage du conteneur modale HTML fixe
        const idModalAires = "modal_resultats_aires";
        let modalExistante = document.getElementById(idModalAires);
        if (modalExistante) modalExistante.remove();

        const modalHtml = `
            <div id="${idModalAires}" style="position: fixed; top: 25%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 15px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); z-index: 10000; width: 440px; font-family: Arial, sans-serif; line-height: 1.5; border-top: 4px solid #2980b9;">
                <h4 style="margin: 0 0 12px 0; color: #2c3e50; border-bottom: 2px solid #2980b9; padding-bottom: 5px; font-size: 14px; font-weight: bold;">
                    Stations sur aires
                </h4>
                <div style="font-size: 11px; color: #333; margin-bottom: 15px;">
                    <div style="font-size: 12px; margin-bottom: 3px;"><strong>Aires C :</strong> 
                        <span style="color: #0078ff; font-weight: bold;">${stats.airesC.total.stationsVL} stations VL</span> (<span style="color: #0078ff;">${stats.airesC.total.pdcVL} pdc</span>) / 
                        <span style="color: #e74c3c; font-weight: bold;">${stats.airesC.total.stationsPL} stations PL</span> (<span style="color: #e74c3c;">${stats.airesC.total.pdcPL} pdc</span>)
                    </div>
                    <div style="padding-left: 15px; color: #555;">• Aires de service : <span style="color: #0078ff;">${stats.airesC.service.stationsVL} st. VL (${stats.airesC.service.pdcVL} pdc)</span> / <span style="color: #e74c3c;">${stats.airesC.service.stationsPL} st. PL (${stats.airesC.service.pdcPL} pdc)</span></div>
                    <div style="padding-left: 15px; color: #555;">• Aires de repos : <span style="color: #0078ff;">${stats.airesC.repos.stationsVL} st. VL (${stats.airesC.repos.pdcVL} pdc)</span> / <span style="color: #e74c3c;">${stats.airesC.repos.stationsPL} st. PL (${stats.airesC.repos.pdcPL} pdc)</span></div>
                    <div style="padding-left: 15px; color: #555;">• Autres aires : <span style="color: #0078ff;">${stats.airesC.autres.stationsVL} st. VL (${stats.airesC.autres.pdcVL} pdc)</span> / <span style="color: #e74c3c;">${stats.airesC.autres.stationsPL} st. PL (${stats.airesC.autres.pdcPL} pdc)</span></div>
                    <br>
                    <div style="font-size: 12px; margin-bottom: 3px;"><strong>Aires NC :</strong> 
                        <span style="color: #0078ff; font-weight: bold;">${stats.airesNC.total.stationsVL} stations VL</span> (<span style="color: #0078ff;">${stats.airesNC.total.pdcVL} pdc</span>) / 
                        <span style="color: #e74c3c; font-weight: bold;">${stats.airesNC.total.stationsPL} stations PL</span> (<span style="color: #e74c3c;">${stats.airesNC.total.pdcPL} pdc</span>)
                    </div>
                    <div style="padding-left: 15px; color: #555;">• Aires de service : <span style="color: #0078ff;">${stats.airesNC.service.stationsVL} st. VL (${stats.airesNC.service.pdcVL} pdc)</span> / <span style="color: #e74c3c;">${stats.airesNC.service.stationsPL} st. PL (${stats.airesNC.service.pdcPL} pdc)</span></div>
                    <div style="padding-left: 15px; color: #555;">• Aires de repos : <span style="color: #0078ff;">${stats.airesNC.repos.stationsVL} st. VL (${stats.airesNC.repos.pdcVL} pdc)</span> / <span style="color: #e74c3c;">${stats.airesNC.repos.stationsPL} st. PL (${stats.airesNC.repos.pdcPL} pdc)</span></div>
                    <div style="padding-left: 15px; color: #555;">• Autres aires : <span style="color: #0078ff;">${stats.airesNC.autres.stationsVL} st. VL (${stats.airesNC.autres.pdcVL} pdc)</span> / <span style="color: #e74c3c;">${stats.airesNC.autres.stationsPL} st. PL (${stats.airesNC.autres.pdcPL} pdc)</span></div>
                </div>
                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                    <button onclick="exporterStatsAiresExcel()" style="padding: 4px 10px; font-size: 11px; background: #27ae60; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                        Export Excel (${stationsTrouveesPourExcel.length} lignes)
                    </button>
                    <button onclick="document.getElementById('${idModalAires}').remove()" style="padding: 4px 10px; font-size: 11px; background: #7f8c8d; color: white; border: none; border-radius: 4px; cursor: pointer;">Fermer</button>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        // Si le filtre visuel carte est actif, on rafraîchit immédiatement après l'ouverture pour respecter les cases
        filtrerSousAiresSurCarte();
    });
}

// 4. Case à cocher "Afficher sur la carte" + Permutation précise des Filtres et Légendes
const chkFiltrerStationsAires = document.getElementById('chkFiltrerStationsAires');
if (chkFiltrerStationsAires) {
    chkFiltrerStationsAires.addEventListener('change', function() {
        //const legendeStandard = document.getElementById('legende_Qualicharge');
        //const legendeAires = document.getElementById('legende_Qualicharge_Aires');
        
        const wlVL = document.getElementById('wrapper_Qualicharge_VL');
        const wlPL = document.getElementById('wrapper_Qualicharge_PL');
        const wlAiresC = document.getElementById('wrapper_Aires_C');
        const wlAiresNC = document.getElementById('wrapper_Aires_NC');

        if (this.checked) {
            // Initialisation des sous-cases à coché par défaut
            const chk_AfficherAiresC = document.getElementById('chkAfficher_Aires_C');
			const chk_AfficherAiresNC = document.getElementById('chkAfficher_Aires_NC');
            if (chk_AfficherAiresC) chk_AfficherAiresC.checked = true;
            if (chk_AfficherAiresNC) chk_AfficherAiresNC.checked = true;
			
			if(legende_Qualicharge_PL) legende_Qualicharge_PL.style.display = 'none';
			if(legende_Qualicharge_VL) legende_Qualicharge_VL.style.display = 'none';
			
			const legAireC = document.getElementById('legende_Qualicharge_AireC');
			const legAireNC = document.getElementById('legende_Qualicharge_AireNC');
			
			if (legAireC) legAireC.style.display = (chk_AfficherAiresC && chk_AfficherAiresC.checked) ? 'flex' : 'none';
			if (legAireNC) legAireNC.style.display = (chk_AfficherAiresNC && chk_AfficherAiresNC.checked) ? 'flex' : 'none';
			
			

            // Lancement initial (vrai, vrai)
            const resultat = traiterStationsSurAires(true, true);
            if (!resultat) {
                alert("Données Qualicharge indisponibles ou non chargées.");
                this.checked = false;
                return;
            }

            // Calcul et écriture des totaux entre parenthèses
            const totalAiresC = resultat.stats.airesC.total.stationsVL + resultat.stats.airesC.total.stationsPL;
            const totalAiresNC = resultat.stats.airesNC.total.stationsVL + resultat.stats.airesNC.total.stationsPL;
            const txtNbAiresC = document.getElementById('txt_nb_aires_c');
            const txtNbAiresNC = document.getElementById('txt_nb_aires_nc');
            if (txtNbAiresC) txtNbAiresC.textContent = `(${totalAiresC})`;
            if (txtNbAiresNC) txtNbAiresNC.textContent = `(${totalAiresNC})`;

            if (map.hasLayer(coucheQualicharge)) map.removeLayer(coucheQualicharge);
            coucheStationsAires.addTo(map);

            if (wlVL) wlVL.style.display = 'none';
            if (wlPL) wlPL.style.display = 'none';
            if (wlAiresC) wlAiresC.style.display = 'inline-block';
            if (wlAiresNC) wlAiresNC.style.display = 'inline-block';

           // if (legendeStandard) legendeStandard.style.display = 'none';
            //if (legendeAires) legendeAires.style.display = 'block';

        } else {
            map.removeLayer(coucheStationsAires);
			
			if(legende_Qualicharge_PL) legende_Qualicharge_PL.style.display = 'flex';
			if(legende_Qualicharge_VL) legende_Qualicharge_VL.style.display = 'flex';
			
			const legAireC = document.getElementById('legende_Qualicharge_AireC');
			const legAireNC = document.getElementById('legende_Qualicharge_AireNC');
			
			if (legAireC) legAireC.style.display = 'none';
			if (legAireNC) legAireNC.style.display = 'none';
			
            
            const chkQualichargeOrigine = document.getElementById('chkQualicharge');
            if (!chkQualichargeOrigine || chkQualichargeOrigine.checked) {
                coucheQualicharge.addTo(map);
            }

            if (wlVL) wlVL.style.display = 'inline-block';
            if (wlPL) wlPL.style.display = 'inline-block';
            if (wlAiresC) wlAiresC.style.display = 'none';
            if (wlAiresNC) wlAiresNC.style.display = 'none';

            //if (legendeStandard) legendeStandard.style.display = 'block';
            //if (legendeAires) legendeAires.style.display = 'none';
        }
        
        if (typeof rafraichirAffichageLegende === 'function') {
            rafraichirAffichageLegende();
        }
    });
}

// Fonction appelée en direct pour lire l'état actuel des deux sous-cases et filtrer la carte
function filtrerSousAiresSurCarte() {
    const chkFiltrerAires = document.getElementById('chkFiltrerStationsAires');
    if (!chkFiltrerAires || !chkFiltrerAires.checked) return;

    const afficherC = document.getElementById('chkAfficher_Aires_C')?.checked ?? true;
    const afficherNC = document.getElementById('chkAfficher_Aires_NC')?.checked ?? true;
	
	const legAireC = document.getElementById('legende_Qualicharge_AireC');
			const legAireNC = document.getElementById('legende_Qualicharge_AireNC');
			const chk_AfficherAiresC = document.getElementById('chkAfficher_Aires_C');
			const chk_AfficherAiresNC = document.getElementById('chkAfficher_Aires_NC');
			if (legAireC) legAireC.style.display = (chk_AfficherAiresC && chk_AfficherAiresC.checked) ? 'flex' : 'none';
			if (legAireNC) legAireNC.style.display = (chk_AfficherAiresNC && chk_AfficherAiresNC.checked) ? 'flex' : 'none';

    // Relance la fonction principale modifiée avec les arguments de filtrage cartographique
    traiterStationsSurAires(afficherC, afficherNC);
}

// Liaison immédiate des écouteurs d'événements pour filtrer en direct au décochage
document.addEventListener('DOMContentLoaded', () => {
    const chkAiresC = document.getElementById('chkAfficher_Aires_C');
    const chkAiresNC = document.getElementById('chkAfficher_Aires_NC');
    
    if (chkAiresC) chkAiresC.addEventListener('change', filtrerSousAiresSurCarte);
    if (chkAiresNC) chkAiresNC.addEventListener('change', filtrerSousAiresSurCarte);
	
	const legAireC = document.getElementById('legende_Qualicharge_AireC');
			const legAireNC = document.getElementById('legende_Qualicharge_AireNC');
			
			if (legAireC) legAireC.style.display = (chkAiresC && chkAiresC.checked) ? 'flex' : 'none';
			if (legAireNC) legAireNC.style.display = (chkAiresNC && chkAiresNC.checked) ? 'flex' : 'none';
});

// 5. Export Excel
window.exporterStatsAiresExcel = function() {
    const donnees = window.derniereDonneesAiresExcel;
    if (!donnees || donnees.length === 0) return;
    const feuille = XLSX.utils.json_to_sheet(donnees);
    const classeur = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(classeur, feuille, "Détail Stations Aires");
    XLSX.writeFile(classeur, "Qualicharge_Details_Aires.xlsx");
};



//Carrefours qualicharge


// ----------------- FONCTIONNALITÉ CARREFOURS -----------------


let baseCarrefoursStationsTraitees = null;

// Fonction de filtrage spatial : vérifie si un point est à l'intérieur d'un polygone GeoJSON
function pointDansPolygone(lat, lng, geojson) {
    if (!geojson || !geojson.features) return false;
    let pt = turf.point([lng, lat]); 
    
    let dansPolygone = false;
    geojson.features.forEach(feature => {
        if (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon") {
            let layer = L.GeoJSON.geometryToLayer(feature);
            if (layer.getBounds().contains(L.latLng(lat, lng))) {
                dansPolygone = true; // Vérification simplifiée par boîte englobante ou rayon d'aire
            }
        }
    });
    return dansPolygone;
}

// Fonction principale calquée sur le traitement "Stations sur Aires"
// ----------------- FONCTIONNALITÉ CARREFOURS -----------------


// Variable globale de cache pour conserver les résultats OSRM en mémoire
window.stationsCarrefoursTrouvees = null;



function traiterStationsCarrefours() {
    const chk = document.getElementById('chkFiltrerCarrefours');
    if (!chk) return;

    // Si décoché : on retire simplement la couche de la carte et met à jour la légende
    if (!chk.checked) {
        map.removeLayer(coucheCarrefours);
        document.getElementById('options_Carrefours').style.display = 'none';
        if (typeof rafraichirAffichageLegende === 'function') rafraichirAffichageLegende();
		
		const legCarrefour = document.getElementById('legende_Qualicharge_Carrefour');
			
			
			if (legCarrefour) legCarrefour.style.display = (chkFiltrerCarrefours && chkFiltrerCarrefours.checked) ? 'flex' : 'none';
        return;
    }

    // --- FORCE DU CHARGEMENT DEPUIS LE LOCAL STORAGE (ANTI-RECALCUL) ---
    if (!window.stationsCarrefoursTrouvees) {
        try {
            const localData = localStorage.getItem('stations_carrefours_json');
            if (localData) {
                window.stationsCarrefoursTrouvees = JSON.parse(localData);
            }
        } catch (e) {
            console.error("Erreur d'accès au localStorage carrefours :", e);
        }
    }

    // Si on a des données chargées en cache
    if (window.stationsCarrefoursTrouvees !== null && window.stationsCarrefoursTrouvees.length > 0) {
        document.getElementById('options_Carrefours').style.display = 'block';
		document.getElementById('statutCarrefours').innerText = "Chargement en cours...";

		coucheCarrefours.clearLayers();
        window.stationsCarrefoursTrouvees.forEach(st => creerMarqueurCarrefourStation(st));
        coucheCarrefours.addTo(map);
		
			const legCarrefour = document.getElementById('legende_Qualicharge_Carrefour');
			
			
			if (legCarrefour) legCarrefour.style.display = (chkFiltrerCarrefours && chkFiltrerCarrefours.checked) ? 'flex' : 'none';
			
			
        document.getElementById('options_Carrefours').style.display = 'none';
        if (typeof rafraichirAffichageLegende === 'function') rafraichirAffichageLegende();
        
        return; 
    }
    // -------------------------------------------------------------------

    // Si aucun cache n'existe, on démarre le calcul OSRM
    //document.getElementById('options_Carrefours').style.display = 'block';
	
	
	
	window.calculCarrefoursEnCours = true;
    const optionsElem = document.getElementById('options_Carrefours') || options_Carrefours;
    const statutElem = document.getElementById('statutCarrefours') || statutCarrefours;

    if (optionsElem) optionsElem.style.display = 'block';
    if (statutElem) {
        statutElem.style.color = "orange";
        statutElem.textContent = "⏳ Chargement et analyse spatiale en cours...";
    }

    // 2. ÉTAPE ASYNCHRONE : On laisse 50 ms au navigateur pour rendre/afficher le texte ci-dessus
    // avant de lancer les boucles JS gourmandes en calculs CPU
    setTimeout(() => {

    let sourceDonnees = window.baseQualichargeTraitee || baseQualichargeTraitee;
    if (!sourceDonnees || sourceDonnees.length === 0) {
        document.getElementById('statutCarrefours').innerText = "Erreur : Données Qualicharge non chargées.";
        window.calculCarrefoursEnCours = false;
		return;
    }

    let stationsFiltrees = [];
    sourceDonnees.forEach(borne => {
        const lat = parseFloat(borne.a || borne.latitude);
        const lng = parseFloat(borne.o || borne.longitude);
        if (isNaN(lat) || isNaN(lng)) return;

        let dansAireC = (window.donnees_Aires_C) ? findFeatureContainingPoint([lat, lng], window.donnees_Aires_C) : null;
        let dansAireNC = (window.donnees_Aires_NC) ? findFeatureContainingPoint([lat, lng], window.donnees_Aires_NC) : null;
        if (dansAireC || dansAireNC) return;

        let sousStationsPuissantes = [];
        if (borne.s && Array.isArray(borne.s)) {
            borne.s.forEach(sub => {
                let chainePuissance = String(sub.u || sub.puissance_nominale || sub.p_max || "");
                let nombresTrouves = chainePuissance.match(/\d+/g);
                let aAuMoins50 = nombresTrouves && nombresTrouves.some(p => parseFloat(p) >= 50);
                
                if (aAuMoins50) {
                    sousStationsPuissantes.push(sub);
                }
            });
        } 

        if (sousStationsPuissantes.length > 0) {
            stationsFiltrees.push({
                nom: borne.s[0].n || borne.nom_station || "Station Haute Puissance",
                operateur: borne.s[0].m || borne.nom_operateur || "Inconnu",
                amenageur: borne.s[0].am || borne.nom_amenageur || "Inconnu",
                lat: lat,
                lng: lng,
                pointsDeCharge: sousStationsPuissantes
            });
        }
    });

    let carrefoursFeatures = window.donnees_Carrefours?.features;
    if (!carrefoursFeatures) {
        document.getElementById('statutCarrefours').innerText = "Fichier carrefours.js introuvable.";
        window.calculCarrefoursEnCours = false;
		return;
    }

    coucheCarrefours.clearLayers();
    let stationsAjouteesAuSet = new Set();
    let sousRequetesAExecuter = [];

    carrefoursFeatures.forEach(carrefourFeat => {
        let coordsCarrefour = carrefourFeat.geometry.coordinates; 
        
        let stationsProchesCandidat = stationsFiltrees.filter(st => {
            let distVolOiseau = map.distance(L.latLng(st.lat, st.lng), L.latLng(coordsCarrefour[1], coordsCarrefour[0]));
            return distVolOiseau <= 4200;
        });

        if (stationsProchesCandidat.length === 0) return;

        const taillePaquet = 100;
        for (let i = 0; i < stationsProchesCandidat.length; i += taillePaquet) {
            let chunkStations = stationsProchesCandidat.slice(i, i + taillePaquet);
            sousRequetesAExecuter.push({
                coordsCarrefour: coordsCarrefour,
                chunkStations: chunkStations
            });
        }
    });

    if (sousRequetesAExecuter.length === 0) {
        document.getElementById('statutCarrefours').innerText = "0 station à proximité des carrefours.";
        window.stationsCarrefoursTrouvees = [];
        window.calculCarrefoursEnCours = false;
		return;
    }

    let indexPaquet = 0;
    let listeFinaleCache = [];

    function executerProchainPaquet() {
        if (indexPaquet >= sousRequetesAExecuter.length) {
            window.stationsCarrefoursTrouvees = listeFinaleCache;
            
            try {
                localStorage.setItem('stations_carrefours_json', JSON.stringify(listeFinaleCache));
            } catch(e) {
                console.error("Impossible de sauvegarder dans le localStorage :", e);
            }
            
            // On ajoute à la carte car l'utilisateur a explicitement coché la case pour initier ce calcul
            coucheCarrefours.addTo(map);
            if (optionsElem) optionsElem.style.display = 'none';
            
            if (typeof rafraichirAffichageLegende === 'function') rafraichirAffichageLegende();
            window.calculCarrefoursEnCours = false;
			return;
        }

       if (statutElem) statutElem.innerText = `⏳ Calcul en cours... Paquet ${indexPaquet + 1} / ${sousRequetesAExecuter.length}`;
	   
        let item = sousRequetesAExecuter[indexPaquet];
        let coordsCarrefour = item.coordsCarrefour;
        let chunkStations = item.chunkStations;

        let listeCoordsString = `${coordsCarrefour[0]},${coordsCarrefour[1]};` + 
            chunkStations.map(st => `${st.lng},${st.lat}`).join(';');

        let urlTableOSRM = `https://router.project-osrm.org/table/v1/driving/${listeCoordsString}?sources=0&annotations=distance`;

        fetch(urlTableOSRM)
            .then(res => {
                if (!res.ok) throw new Error(`Erreur HTTP: ${res.status}`);
                return res.json();
            })
            .then(data => {
                if (data.code === 'Ok' && data.distances && data.distances[0]) {
                    let distancesRoute = data.distances[0];

                    chunkStations.forEach((station, indexStation) => {
                        let distanceMetres = distancesRoute[indexStation + 1];

                        if (distanceMetres !== null && distanceMetres <= 3000) {
                            let cleUnique = `${station.lat}_${station.lng}`;
                            if (!stationsAjouteesAuSet.has(cleUnique)) {
                                stationsAjouteesAuSet.add(cleUnique);
                                listeFinaleCache.push(station);
                                creerMarqueurCarrefourStation(station);
                            }
                        }
                    });
                }
                indexPaquet++;
                setTimeout(executerProchainPaquet, 50);
            })
            .catch(err => {
                console.warn("Paquet ignoré", err);
                indexPaquet++;
                setTimeout(executerProchainPaquet, 100);
            });
    }

    executerProchainPaquet();
	}, 50);
	
}

function afficherPopupCalculEnCours() {
    // Si la modale existe déjà, on ne la duplique pas
    if (document.getElementById('modalCalculEnCours')) return;

    const overlay = document.createElement('div');
    overlay.id = 'modalCalculEnCours';
    overlay.style.cssText = `
        position: fixed;
        top: 0; left: 0; width: 100vw; height: 100vh;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex; align-items: center; justify-content: center;
        z-index: 10000;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
        background: #ffffff;
        padding: 20px 30px;
        border-radius: 8px;
        text-align: center;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        max-width: 320px;
        font-family: sans-serif;
    `;

    const message = document.createElement('p');
    message.style.cssText = "margin: 0 0 18px 0; font-size: 15px; color: #333; font-weight: 500;";
    message.textContent = "Calcul en cours, veuillez patienter";

    const btnFermer = document.createElement('button');
    btnFermer.textContent = "Fermer";
    btnFermer.style.cssText = `
        padding: 8px 18px;
        background-color: #007bff;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
    `;

    btnFermer.addEventListener('click', () => {
        overlay.remove();
    });

    box.appendChild(message);
    box.appendChild(btnFermer);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
}

// ICÔNE ET DU CALCUL DES POINTS DE CHARGE INDIVIDUELS
function creerMarqueurCarrefourStation(station) {
    const iconeCarrefour = L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="width: 12px; height: 12px; background-color: #8e44ad; border-radius: 50%; border: 1.5px solid #fff; box-shadow: 0 0 4px rgba(0,0,0,0.4);"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6]
    });

    
    let totalPdcStation = 0;
    station.pointsDeCharge.forEach(sub => {
        totalPdcStation += (parseInt(sub.p || sub.nombre_points_charge, 10) || 1);
    });
	const coordsStr = `${station.lat},${station.lng}`;
    const popupContenu = `
        <div style="font-family: Arial, sans-serif; font-size: 12px; color: #333; line-height: 1.4;">
            <b style="font-size: 13px; color: #8e44ad;">${station.nom}</b><br>
            <b>Aménageur :</b> ${station.amenageur}<br>
            <b>Opérateur :</b> ${station.operateur}<br>
            <b>Points de charge HP (≥50kW) :</b> <span style="font-weight:bold; color:#e74c3c;">${totalPdcStation}</span><br>
            <hr style="margin: 5px 0; border: 0; border-top: 1px dashed #ccc;">
            <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${station.lat},${station.lng}" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/StreetView.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Street View"> StreetView</a><br><a href="https://www.google.com/maps/search/?api=1&query=${station.lat},${station.lng}&basemap=roadmap" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Maps.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Maps"> Maps</a><br><a href="https://earth.google.com/web/@${station.lat},${station.lng},100a,350d,35y,0h,0t,0r" target="_blank" onclick="copierDansPressePapier('${coordsStr}')" style="text-decoration: none; color: #3498db; display: inline-flex; align-items: center; gap: 6px; font-weight: bold;"><img src="FICHIERS/Earth.png" style="height: 16px; width: auto; vertical-align: middle;" alt="Google Earth"> Earth</a>
        </div>
    `;

    let marqueur = L.marker([station.lat, station.lng], { icon: iconeCarrefour })
        .bindPopup(popupContenu);
        
    coucheCarrefours.addLayer(marqueur);
}

// AFFICHAGE DU POPUP DE SYNTHÈSE SYNCHRONISÉ (Style Aires)
function afficherPopupResultatsCarrefours() {
    let stations = window.stationsCarrefoursTrouvees || [];
    let totalPointsCharge = 0;
    
    stations.forEach(st => {
        st.pointsDeCharge.forEach(sub => {
            totalPointsCharge += (parseInt(sub.p, 10) || 1);
        });
    });

    // Création d'une fenêtre modale flottante stylisée
    const idModal = "modal_resultats_carrefours";
    let modalExistante = document.getElementById(idModal);
    if (modalExistante) modalExistante.remove();

    const modalHtml = `
        <div id="${idModal}" style="position: fixed; top: 25%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 15px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); z-index: 10000; min-width: 280px; font-family: sans-serif; border-top: 4px solid #8e44ad;">
            <h3 style="margin: 0 0 10px 0; font-size: 14px; color: #2c3e50;">Stations à moins de 3 km d'un carrefour du RRN NC</h3>
            <p style="font-size: 12px; margin: 5px 0;"><b>Stations avec au moins 1 PdC de 50 kW minimum :</b> ${stations.length}</p>
            <p style="font-size: 12px; margin: 5px 0; margin-bottom: 15px;"><b>Nombre total de points de charge de 50 kW minimum:</b> ${totalPointsCharge}</p>
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button onclick="exporterCarrefoursExcel()" style="padding: 4px 10px; font-size: 11px; background: #27ae60; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Export Excel</button>
                <button onclick="document.getElementById('${idModal}').remove()" style="padding: 4px 10px; font-size: 11px; background: #7f8c8d; color: white; border: none; border-radius: 4px; cursor: pointer;">Fermer</button>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}









// FONCTION EXPORT EXCEL DÉDIÉE POUR LES CARREFOURS
window.exporterCarrefoursExcel = function() {
    let stations = window.stationsCarrefoursTrouvees || [];
    if (stations.length === 0) {
        alert("Aucune donnée disponible pour l'export.");
        return;
    }

    let lignesExcel = [];
    stations.forEach(st => {
        let pdcCount = 0;
        let puissancesDispo = [];
        st.pointsDeCharge.forEach(sub => {
            pdcCount += (parseInt(sub.p, 10) || 1);
            if(sub.u) puissancesDispo.push(sub.u);
        });

        lignesExcel.push({
            "Nom de la Station": st.nom,
            "Aménageur": st.amenageur,
            "Opérateur": st.operateur,
            "Latitude": st.lat,
            "Longitude": st.lng,
            "Nombre Points de Charge HP": pdcCount,
            "Puissances détectées": puissancesDispo.join(" / ")
        });
    });

    if (typeof XLSX === 'undefined') {
        alert("La librairie Excel XLSX n'est pas chargée.");
        return;
    }

    const feuille = XLSX.utils.json_to_sheet(lignesExcel);
    const classeur = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(classeur, feuille, "Stations Carrefours <3km");
    XLSX.writeFile(classeur, "Qualicharge_Proximite_Carrefours.xlsx");
};

// ÉCOUTEURS D'ÉVÉNEMENTS DU BOUTON ET DE LA CASE À COCHER
function initialiserEcouteursCarrefours() {
    const btnCarrefours = document.getElementById('btnCarrefours');
    const chkFiltrerCarrefours = document.getElementById('chkFiltrerCarrefours');

    if (btnCarrefours) {
        btnCarrefours.addEventListener('click', function() {
            // ACTION DU BOUTON :
			
			// 0. VERIFICATION SI CALCUL DEJA EN COURS
            if (window.calculCarrefoursEnCours === true) {
                afficherPopupCalculEnCours();
                return; // On stoppe net, aucune autre action
            }

            // 1. Inversion/Masquage forcé de la carte si la case était cochée
        //    if (chkFiltrerCarrefours && chkFiltrerCarrefours.checked) {
        //        chkFiltrerCarrefours.checked = false;
         //       map.removeLayer(coucheCarrefours);
        //        if (typeof rafraichirAffichageLegende === 'function') rafraichirAffichageLegende();
        //   }

            // 2. Si les données ne sont pas encore en mémoire, on va chercher le cache ou lancer le calcul
            if (!window.stationsCarrefoursTrouvees) {
                try {
                    const localData = localStorage.getItem('stations_carrefours_json');
                    if (localData) {
                        window.stationsCarrefoursTrouvees = JSON.parse(localData);
                    }
                } catch (e) {
                    console.error("Erreur localStorage :", e);
                }
            }

            // 3. Déclenchement exclusif du popup / boîte modale de résultats
            if (window.stationsCarrefoursTrouvees !== null) {
                if (typeof afficherPopupResultatsCarrefours === 'function') {
                    afficherPopupResultatsCarrefours();
                }
            }
			
			else {
        if (chkFiltrerCarrefours) {
                    setTimeout(() => {
						chkFiltrerCarrefours.checked = true;
                    traiterStationsCarrefours();
					}, 0);					// Lance le calcul (qui va passer window.calculCarrefoursEnCours à true)
                }
            }
        });
    }

    // ACTION DE LA CASE À COCHER : Gère uniquement les points sur la carte
    if (chkFiltrerCarrefours) {
        chkFiltrerCarrefours.addEventListener('change', function(e) {
            if (window.calculCarrefoursEnCours === true) {
                afficherPopupCalculEnCours();
                this.checked = !this.checked;
                return;
            }
            traiterStationsCarrefours();
        });
    }
}

// Enregistrement de l'écouteur au chargement du document
document.addEventListener('DOMContentLoaded', initialiserEcouteursCarrefours);

// Appeler l'initialisation dès que le DOM est prêt
document.addEventListener('DOMContentLoaded', initialiserEcouteursCarrefours);

// Ajustement automatique de la taille de la carte lors du pliage/dépliage des sections
window.toggleSection = function(contentId, arrowId) {
    const content = document.getElementById(contentId);
    const arrow = document.getElementById(arrowId);
    if (content && arrow) {
        content.classList.toggle('collapsed');
        if (content.classList.contains('collapsed')) {
            arrow.style.transform = 'rotate(-90deg)';
        } else {
            arrow.style.transform = 'rotate(0deg)';
        }
        if (typeof map !== 'undefined' && map) {
            setTimeout(function() { map.invalidateSize(); }, 200);
        }
    }
};


/* ---------------- FONCTION POUR QUITTER L'APPLICATION ---------------- */


    // Exécution immédiate au démarrage pour s'assurer que tout soit masqué par défaut
    
 nettoyerCarte();
 rafraichirAffichageLegende();
 document.getElementById('legende').style.display = "none"
initAxeSelects();

