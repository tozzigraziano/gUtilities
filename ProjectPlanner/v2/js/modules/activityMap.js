/**
 * js/modules/activityMap.js
 *
 * Mappa attività (Leaflet): visualizza stabilimenti clienti con attività
 * flessibili e/o attive sulla mappa geografica.
 *
 * Leaflet è caricato via CDN nell'HTML — usa window.L.
 */

import * as state from '../state.js';
import { formatDateLocal, areAllResourcesAbsent } from '../helpers.js';

// Istanza Leaflet corrente
let activityMapInstance = null;

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Verifica se una data è giorno lavorativo per una determinata task.
 * Logica equivalente a isWorkingDay() del monolita.
 */
function isWorkingDay(date, task) {
    const dayOfWeek = date.getDay(); // 0 = domenica, 6 = sabato

    if (dayOfWeek === 6 && !task.saturdayWork) return false;
    if (dayOfWeek === 0 && !task.sundayWork)   return false;

    if (!task.holidayWork) {
        const dateStr = formatDateLocal(date);
        const isHoliday = state.holidays.some(h => h.date === dateStr);
        if (isHoliday) return false;
    }

    const dateStr = formatDateLocal(date);
    const taskResources = task.resources || [];
    if (areAllResourcesAbsent(dateStr, taskResources)) return false;

    return true;
}

/**
 * Determina dove si trova la risorsa in un dato giorno.
 * @returns {{ type: 'sede'|'cliente'|'remoto', plantIds: number[], hasWork: boolean }}
 */
export function getResourceLocationForDay(resource, dateStr) {
    const plantIds = new Set();
    let hasClientTask = false;
    let hasAnyTask = false;

    state.projects.forEach(project => {
        if (!project.tasks) return;
        project.tasks.forEach(task => {
            if (!task.startDate || !task.endDate) return;
            if (task.status === 'annullata' || task.status === 'completata' || task.status === 'pausa') return;
            if (!task.resources) return;

            const res = task.resources.find(r => r.resourceId == resource.id);
            if (!res) return;

            const taskStart = new Date(task.startDate);
            const taskEnd   = new Date(task.endDate);
            const checkDate = new Date(dateStr);
            taskStart.setHours(0, 0, 0, 0);
            taskEnd.setHours(23, 59, 59, 999);
            checkDate.setHours(12, 0, 0, 0);

            if (checkDate >= taskStart && checkDate <= taskEnd) {
                if (isWorkingDay(checkDate, task)) {
                    hasAnyTask = true;
                    if (task.locationType === 'cliente') {
                        hasClientTask = true;
                        if (task.plantId) plantIds.add(Number(task.plantId));
                    }
                }
            }
        });
    });

    if (hasClientTask) {
        return { type: 'cliente', plantIds: [...plantIds], hasWork: true };
    }
    return { type: 'sede', plantIds: [], hasWork: hasAnyTask };
}

// ─── Inizializzazione mappa ────────────────────────────────────────────────────

function initMap(byPlant, showAll) {
    const container = document.getElementById('mapContainer');

    // Distruggi mappa esistente
    if (activityMapInstance) {
        activityMapInstance.remove();
        activityMapInstance = null;
    }

    activityMapInstance = L.map('mapContainer').setView([42.5, 12.5], 6);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
        maxZoom: 19,
        subdomains: 'abcd'
    }).addTo(activityMapInstance);

    const bounds = [];

    // Raccogli attività attive presso cliente (non flessibili)
    const activeByPlant = {};
    const showActiveTasks = document.getElementById('mapShowActiveTasks')?.checked || false;
    if (showActiveTasks) {
        state.projects.forEach(project => {
            if (!project.tasks) return;
            project.tasks.forEach(task => {
                if (task.locationType === 'cliente' && task.plantId &&
                    task.status !== 'completata' && task.status !== 'annullata' &&
                    task.completion < 100 &&
                    !task.flexibleDate) {
                    const plant = state.plants.find(p => p.id == task.plantId);
                    if (plant && plant.lat && plant.lng) {
                        const key = plant.id;
                        if (!activeByPlant[key]) {
                            activeByPlant[key] = { plant, tasks: [] };
                        }
                        activeByPlant[key].tasks.push({ project, task });
                    }
                }
            });
        });
    }

    // Unisci tutti gli stabilimenti con attività (flessibili e/o attive)
    const allPlantIds = new Set([...Object.keys(byPlant), ...Object.keys(activeByPlant)]);

    allPlantIds.forEach(plantId => {
        const flexGroup   = byPlant[plantId];
        const activeGroup = activeByPlant[plantId];
        const plant = (flexGroup || activeGroup).plant;
        if (!plant.lat || !plant.lng) return;

        const hasFlexible = flexGroup  && flexGroup.tasks.length  > 0;
        const hasActive   = activeGroup && activeGroup.tasks.length > 0;

        let popupSections = `<strong style="font-size: 14px;">🏭 ${plant.name}</strong><br>
            <small>${plant.client || ''} - ${plant.address || ''}</small>`;

        if (hasFlexible) {
            const taskList = flexGroup.tasks.map(item => {
                const res = item.task.resources?.map(r => {
                    const resource = state.resources.find(rs => rs.id == r.resourceId);
                    return resource ? `${resource.firstName} ${resource.lastName}` : 'Non assegnata';
                }).join(', ') || 'Non assegnata';
                return `<li><strong>${item.task.name}</strong><br>
                        <small>${item.project.client} - ${item.project.code}</small><br>
                        <small>Durata: ${item.task.duration}gg | Risorse: ${res}</small></li>`;
            }).join('');
            popupSections += `<hr style="margin: 5px 0;">
                <strong>💡 ${flexGroup.tasks.length} attività flessibili:</strong>
                <ul style="padding-left: 15px; margin: 5px 0;">${taskList}</ul>`;
        }

        if (hasActive) {
            const taskList = activeGroup.tasks.map(item => {
                const res = item.task.resources?.map(r => {
                    const resource = state.resources.find(rs => rs.id == r.resourceId);
                    return resource ? `${resource.firstName} ${resource.lastName}` : 'Non assegnata';
                }).join(', ') || 'Non assegnata';
                const statusLabel = item.task.status === 'pausa' ? ' ⏸️' : '';
                const dates = item.task.startDate && item.task.endDate
                    ? `${item.task.startDate} → ${item.task.endDate}`
                    : (item.task.startDate || 'Date n.d.');
                return `<li><strong>${item.task.name}${statusLabel}</strong><br>
                        <small>${item.project.client} - ${item.project.code}</small><br>
                        <small>${dates} | ${item.task.duration}gg | ${item.task.completion}% | Risorse: ${res}</small></li>`;
            }).join('');
            popupSections += `<hr style="margin: 5px 0;">
                <strong>🟢 ${activeGroup.tasks.length} attività attive:</strong>
                <ul style="padding-left: 15px; margin: 5px 0;">${taskList}</ul>`;
        }

        const popupContent = `<div style="max-width: 300px; max-height: 300px; overflow-y: auto;">${popupSections}</div>`;

        // Colore marker: arancione = flessibili, verde = solo attive, bicolore = entrambe
        const totalCount = (hasFlexible ? flexGroup.tasks.length : 0) + (hasActive ? activeGroup.tasks.length : 0);
        let markerHtml;
        if (hasFlexible && hasActive) {
            markerHtml = `<div style="background: linear-gradient(135deg, #e65100 50%, #4CAF50 50%); width: 28px; height: 28px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: bold;">${totalCount}</div>`;
        } else if (hasFlexible) {
            markerHtml = `<div style="background: #e65100; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: bold;">${totalCount}</div>`;
        } else {
            markerHtml = `<div style="background: #4CAF50; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: bold;">${totalCount}</div>`;
        }

        const size   = (hasFlexible && hasActive) ? [28, 28] : [24, 24];
        const anchor = (hasFlexible && hasActive) ? [14, 14] : [12, 12];

        const marker = L.marker([plant.lat, plant.lng])
            .addTo(activityMapInstance)
            .bindPopup(popupContent);

        marker.setIcon(L.divIcon({
            className: '',
            html: markerHtml,
            iconSize: size,
            iconAnchor: anchor
        }));

        bounds.push([plant.lat, plant.lng]);
    });

    // Aggiungi anche stabilimenti senza attività se richiesto
    if (showAll) {
        state.plants.forEach(plant => {
            if (!plant.lat || !plant.lng) return;
            if (allPlantIds.has(String(plant.id))) return; // già aggiunto sopra

            const marker = L.marker([plant.lat, plant.lng], { zIndexOffset: -1000 })
                .addTo(activityMapInstance)
                .bindPopup(`<strong>🏭 ${plant.name}</strong><br><small>${plant.client || ''} - ${plant.address || ''}</small>`);

            marker.setIcon(L.divIcon({
                className: '',
                html: `<div style="background: #1565c0; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.2); opacity: 0.7;"></div>`,
                iconSize: [12, 12],
                iconAnchor: [6, 6]
            }));

            bounds.push([plant.lat, plant.lng]);
        });
    }

    // Adatta la view ai marker
    if (bounds.length > 0) {
        activityMapInstance.fitBounds(bounds, { padding: [30, 30] });
    } else {
        // Nessuno stabilimento con coordinate
        const noData = document.createElement('div');
        noData.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1000; background: var(--bg-secondary); padding: 20px; border-radius: 8px; text-align: center;';
        noData.innerHTML = '<p style="font-size: 16px;">📍 Nessuno stabilimento con coordinate disponibile.</p><p style="font-size: 12px; color: var(--text-tertiary);">Aggiungi latitudine e longitudine agli stabilimenti per visualizzarli sulla mappa.</p>';
        container.style.position = 'relative';
        container.appendChild(noData);
    }
}

// ─── Render principale ────────────────────────────────────────────────────────

export function renderActivityMap() {
    const container = document.getElementById('mapContainer');
    if (!container) return;

    // Raccogli attività flessibili presso cliente con stabilimento
    const flexibleClientTasks = [];
    state.projects.forEach(project => {
        if (!project.tasks) return;
        project.tasks.forEach(task => {
            if (task.flexibleDate && task.completion === 0 &&
                task.status !== 'pausa' && task.status !== 'annullata') {
                if (task.locationType === 'cliente' && task.plantId) {
                    const plant = state.plants.find(p => p.id == task.plantId);
                    if (plant) flexibleClientTasks.push({ project, task, plant });
                }
            }
        });
    });

    // Raggruppa per stabilimento
    const byPlant = {};
    flexibleClientTasks.forEach(item => {
        const key = item.plant.id;
        if (!byPlant[key]) byPlant[key] = { plant: item.plant, tasks: [] };
        byPlant[key].tasks.push(item);
    });

    const showAll = document.getElementById('mapShowAllPlants')?.checked || false;

    // Carica Leaflet via CDN se non ancora presente
    if (!window.L) {
        const link = document.createElement('link');
        link.rel  = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);

        const script    = document.createElement('script');
        script.src      = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.onload   = () => initMap(byPlant, showAll);
        document.head.appendChild(script);
    } else {
        initMap(byPlant, showAll);
    }
}
