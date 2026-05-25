/**
 * Localizador Geográfico 🗺️
 * Plugin Oficial de SERA v4
 *
 * Convierte coordenadas en enlaces interactivos a OpenStreetMap de forma local.
 * Genera un visualizador interactivo con mapa embebido y grilla de pines para toda la tabla.
 */

(function () {
  'use strict';

  if (typeof window.SeraAPI === 'undefined') {
    console.error('[Localizador Geográfico] window.SeraAPI no está disponible.');
    return;
  }

  const api = window.SeraAPI;
  const PLUGIN_ID = 'sera-plugin-mapa';

  // Expresión regular para capturar coordenadas lat, lng válidas
  const regexCoords = /^\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)\s*$/;

  // Parsea y valida el formato "lat, lng"
  const parsearCoordenadas = (val) => {
    if (!val) return null;
    const match = String(val).trim().match(regexCoords);
    if (!match) return null;
    return {
      lat: parseFloat(match[1]),
      lng: parseFloat(match[3])
    };
  };

  // 1. REGISTRAR CELL RENDERERS PARA COLUMNAS RELACIONADAS A COORDENADAS
  const columnasCoordenadas = ['coordenadas', 'coord', 'gps', 'lat_lng', 'ubicacion'];

  columnasCoordenadas.forEach((colName) => {
    api.ui.registerCellRenderer(colName, (value) => {
      if (!value) return '<span style="opacity:0.3">—</span>';
      
      const coords = parsearCoordenadas(value);
      if (!coords) return `<span>${value}</span>`;

      // Badge clickable estético a OpenStreetMap
      const osmUrl = `https://www.openstreetmap.org/?mlat=${coords.lat}&mlon=${coords.lng}#map=16/${coords.lat}/${coords.lng}`;
      return `
        <a class="badge-mapa-link" href="${osmUrl}" target="_blank" title="Ver en OpenStreetMap">
          <span style="font-size:12px;vertical-align:middle;margin-right:3px">📍</span> ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}
        </a>
      `;
    });
  });

  // 2. BOTÓN EN EL RIBBON - MAPA DE REGISTROS (VISUALIZADOR UNIFICADO)
  api.ui.registerRibbonButton({
    id: `${PLUGIN_ID}-view-map-btn`,
    label: 'Mapa de Registros',
    icon: 'map',
    tooltip: 'Abre un mapa unificado con la ubicación geográfica de tus registros',
    action: async () => {
      const activeTab = document.querySelector('.desktop-tab-group .mdc-tab--active .tab-title');
      if (!activeTab) {
        api.env.showNotification('Por favor, abrí una tabla para ver su mapa de registros.', 'info');
        return;
      }

      const rawName = activeTab.textContent.trim().toLowerCase().split(' ').join('_');
      if (rawName.startsWith('res:')) {
        api.env.showNotification('Pestaña de búsqueda activa. Por favor abrí una tabla real.', 'info');
        return;
      }

      try {
        const campos = await api.data.getCampos(rawName);
        
        // Buscar el campo de coordenadas
        const campoCoord = campos.find(c => {
          const lower = (c.Field || c.nombre || '').toLowerCase();
          return columnasCoordenadas.includes(lower);
        });

        if (!campoCoord) {
          api.env.showNotification(`La tabla "${activeTab.textContent.trim()}" no posee columnas de coordenadas válidas (coordenadas, coord, gps, lat_lng).`, 'warning');
          return;
        }

        const registros = await api.data.getContenido(rawName);
        const pines = [];

        // Identificar el campo más probable de etiqueta (nombre, expediente, id, etc.)
        const campoEtiqueta = campos.find(c => {
          const lower = (c.Field || c.nombre || '').toLowerCase();
          return lower.includes('nombre') || lower.includes('expediente') || lower.includes('titulo') || lower.includes('cuit') || lower.includes('proveedor') || lower.includes('asunto');
        }) || campos[0];

        const idClave = `id_${rawName.toLowerCase()}`;

        registros.forEach((r) => {
          const valCoord = r[campoCoord.Field || campoCoord.nombre];
          const coords = parsearCoordenadas(valCoord);
          if (coords) {
            const etiqueta = r[campoEtiqueta.Field || campoEtiqueta.nombre] || `Registro #${r[idClave] || r['id'] || ''}`;
            pines.push({
              id: r[idClave] || r['id'] || Math.random().toString(),
              etiqueta: etiqueta,
              lat: coords.lat,
              lng: coords.lng
            });
          }
        });

        if (pines.length === 0) {
          api.env.showNotification('No se encontraron registros con coordenadas válidas para graficar.', 'warning');
          return;
        }

        abrirModalMapaUnificado(activeTab.textContent.trim(), pines);

      } catch (err) {
        console.error('[Mapa] Error al procesar visualizador:', err);
        api.env.showNotification('Ocurrió un error al cargar el mapa de registros.', 'error');
      }
    }
  });

  // ─────────────────────────────────────────────
  // G. MODAL VISUALIZADOR DE MAPA EMBEBIDO
  // ─────────────────────────────────────────────
  
  const abrirModalMapaUnificado = (tituloTabla, pines) => {
    // Limpiar modal viejo si quedó por algún motivo
    const modalExistente = document.getElementById('mapa-unified-modal');
    if (modalExistente) modalExistente.remove();

    // Crear overlay
    const overlay = document.createElement('div');
    overlay.className = 'mapa-modal-overlay';
    overlay.id = 'mapa-unified-modal';

    // Armar lista de pines HTML
    const pinsHtml = pines.map((p, index) => `
      <div class="pin-entry ${index === 0 ? 'active' : ''}" id="mapa-pin-${p.id}" data-lat="${p.lat}" data-lng="${p.lng}">
        <span class="pin-label">${p.etiqueta}</span>
        <span class="pin-coords">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span>
      </div>
    `).join('');

    // OSM Iframe de exportación estándar
    const buildOsmEmbedUrl = (lat, lng) => {
      const delta = 0.005; // Ajustar zoom de encuadre
      return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - delta}%2C${lat - delta}%2C${lng + delta}%2C${lat + delta}&layer=mapnik&marker=${lat}%2C${lng}`;
    };

    overlay.innerHTML = `
      <div class="mapa-modal">
        <div class="mapa-modal-header">
          <div class="header-left">
            <span class="modal-icon">🗺️</span>
            <h3>Mapa de Registros — ${tituloTabla.toUpperCase()}</h3>
          </div>
          <button class="btn-close-modal" id="mapa-btn-close-modal">✕</button>
        </div>
        <div class="mapa-modal-body">
          <div class="mapa-frame-container">
            <iframe 
              id="mapa-iframe-embed"
              src="${buildOsmEmbedUrl(pines[0].lat, pines[0].lng)}"
            ></iframe>
          </div>
          <div class="mapa-pins-list">
            <h4>Registros ubicados (${pines.length})</h4>
            ${pinsHtml}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Cerrar modal
    document.getElementById('mapa-btn-close-modal').addEventListener('click', () => {
      overlay.remove();
    });

    // Interacción al hacer click en los pines de la lista
    pines.forEach((p) => {
      const btnEntry = document.getElementById(`mapa-pin-${p.id}`);
      if (btnEntry) {
        btnEntry.addEventListener('click', () => {
          // Desactivar pin anterior activo
          const activePin = document.querySelector('.pin-entry.active');
          if (activePin) activePin.classList.remove('active');

          // Activar nuevo pin
          btnEntry.classList.add('active');

          // Actualizar Iframe
          const iframe = document.getElementById('mapa-iframe-embed');
          if (iframe) {
            iframe.src = buildOsmEmbedUrl(p.lat, p.lng);
          }
        });
      }
    });
  };

  // Notificación de carga
  api.env.showNotification('🧩 Localizador Geográfico 🗺️ cargado correctamente', 'info');
  console.log('[Mapa] Plugin inicializado correctamente ✅');

})();
