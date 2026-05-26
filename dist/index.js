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

        // Identificar el campo más probable de etiqueta (nombre, expediente, id, etc.)
        const campoEtiqueta = campos.find(c => {
          const lower = (c.Field || c.nombre || '').toLowerCase();
          return lower.includes('nombre') || lower.includes('expediente') || lower.includes('titulo') || lower.includes('cuit') || lower.includes('proveedor') || lower.includes('asunto');
        }) || campos[0];

        const idClave = `id_${rawName.toLowerCase()}`;
        const registros = await api.data.getContenido(rawName);

        if (!campoCoord) {
          // Si no tiene columnas de coordenadas directas, abrimos el selector de campos para geolocalizar por dirección
          abrirModalSelectorCampos(activeTab.textContent.trim(), campos, registros, idClave, campoEtiqueta);
          return;
        }

        const pines = [];

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

  // ─────────────────────────────────────────────
  // H. SELECTOR DE COLUMNAS PARA DIRECCIÓN POSTAL
  // ─────────────────────────────────────────────
  
  const abrirModalSelectorCampos = (tituloTabla, campos, registros, idClave, campoEtiqueta) => {
    const modalId = 'mapa-selector-modal';
    const exist = document.getElementById(modalId);
    if (exist) exist.remove();

    const overlay = document.createElement('div');
    overlay.className = 'mapa-modal-overlay';
    overlay.id = modalId;

    // Filtrar campos útiles (de texto o numéricos comunes, no ids ni adjuntos ni de sistema)
    const camposUtiles = campos.filter(c => {
      const name = (c.Field || c.nombre || '').toLowerCase();
      return name !== idClave && name !== 'id' && !name.startsWith('sera_') && name !== 'actions';
    });

    const optionsHtml = camposUtiles.map(c => `
      <label class="mapa-checkbox-option" style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer;">
        <input type="checkbox" class="mapa-field-checkbox" value="${c.Field || c.nombre}" style="width:16px; height:16px;">
        <span style="font-size:13px; text-transform:uppercase; font-weight:600; color:#cbd5e1;">${(c.Field || c.nombre).split('_').join(' ')}</span>
      </label>
    `).join('');

    overlay.innerHTML = `
      <div class="mapa-modal" style="max-width: 440px; height: auto; min-height: 280px; padding: 24px; display:flex; flex-direction:column; gap:16px;">
        <div class="mapa-modal-header" style="padding-bottom:12px; border-bottom: 1px solid rgba(255,255,255,0.08)">
          <div class="header-left">
            <span class="modal-icon">📍</span>
            <h3 style="margin:0; font-size:16px; font-weight:600;">Georreferenciar por Dirección</h3>
          </div>
          <button class="btn-close-modal" id="mapa-btn-close-selector">✕</button>
        </div>
        <div class="mapa-modal-body" style="display:flex; flex-direction:column; gap:16px; flex:none; height:auto; overflow:visible;">
          <p style="margin:0; font-size:13px; opacity:0.8; line-height:1.4; color:#94a3b8;">
            No detectamos columnas directas de coordenadas GPS en esta tabla. 
            Marcá una o más columnas para componer la dirección postal (e.g. calle, altura, localidad):
          </p>
          <div class="mapa-options-container" style="max-height:160px; overflow-y:auto; background:rgba(0,0,0,0.2); padding:12px; border-radius:8px; border:1px solid rgba(255,255,255,0.05); display:flex; flex-direction:column; gap:2px;">
            ${optionsHtml}
          </div>
          <button id="mapa-btn-geolocalizar" class="btn-mapa-geolocalizar" style="background:var(--sera-primary-color, #00bcd4); color:#000; border:none; padding:10px; border-radius:8px; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; font-size:13px; transition:all 0.2s; height:40px; width:100%;">
            <span>Ubicar Registros</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('mapa-btn-close-selector').addEventListener('click', () => {
      overlay.remove();
    });

    document.getElementById('mapa-btn-geolocalizar').addEventListener('click', async () => {
      const checkboxes = document.querySelectorAll('.mapa-field-checkbox:checked');
      if (checkboxes.length === 0) {
        api.env.showNotification('Por favor, seleccioná al menos una columna de dirección.', 'warning');
        return;
      }

      const camposSeleccionados = Array.from(checkboxes).map((cb) => cb.value);
      overlay.remove();

      // Iniciar proceso de Geocoding
      await iniciarGeocodingProceso(tituloTabla, camposSeleccionados, registros, idClave, campoEtiqueta);
    });
  };

  const iniciarGeocodingProceso = async (tituloTabla, camposDireccion, registros, idClave, campoEtiqueta) => {
    // Inyectar overlay de carga
    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'mapa-modal-overlay';
    loadingOverlay.id = 'mapa-loading-overlay';
    loadingOverlay.innerHTML = `
      <div class="mapa-modal" style="max-width: 340px; text-align:center; padding:32px; display:flex; flex-direction:column; align-items:center; gap:16px; height:auto; min-height:180px;">
        <span style="font-size:36px; animation: bounce 1s infinite; display:inline-block;">🗺️</span>
        <h4 style="margin:0; font-size:14px; font-weight:600; color:#e2e8f0;">Georreferenciando Direcciones...</h4>
        <p id="mapa-loading-text" style="margin:0; font-size:12px; opacity:0.7; color:#94a3b8;">Procesando registros...</p>
        <div style="width:100%; height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden; position:relative; margin-top:8px;">
          <div id="mapa-progress-bar" style="width:0%; height:100%; background:var(--sera-primary-color, #00bcd4); transition:width 0.2s ease;"></div>
        </div>
      </div>
    `;
    document.body.appendChild(loadingOverlay);

    const pines = [];
    const total = registros.length;
    let procesados = 0;

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    for (let i = 0; i < total; i++) {
      const r = registros[i];
      
      // Construir la dirección postal concatenando los valores de los campos elegidos en orden
      const partesDireccion = camposDireccion.map(f => r[f]).filter(val => val !== undefined && val !== null && String(val).trim() !== '');
      const direccionCompleta = partesDireccion.join(', ').trim();

      if (direccionCompleta) {
        try {
          // LLAMADA A NOMINATIM (OSM)
          const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(direccionCompleta)}&limit=1`, {
            headers: {
              'Accept-Language': 'es'
            }
          });

          if (response.ok) {
            const data = await response.json();
            if (data && data.length > 0) {
              const lat = parseFloat(data[0].lat);
              const lng = parseFloat(data[0].lon);
              
              const etiqueta = r[campoEtiqueta.Field || campoEtiqueta.nombre] || `Registro #${r[idClave] || r['id'] || ''}`;
              pines.push({
                id: r[idClave] || r['id'] || Math.random().toString(),
                etiqueta: `${etiqueta} (${direccionCompleta})`,
                lat: lat,
                lng: lng
              });
            }
          }
        } catch (e) {
          console.warn(`[Localizador Mapa] Error de geocoding para: ${direccionCompleta}`, e);
        }

        // Delay para no saturar Nominatim (política OSM de 1 segundo de cooldown)
        await delay(1000);
      }

      procesados++;
      const pct = Math.round((procesados / total) * 100);
      const progressBar = document.getElementById('mapa-progress-bar');
      const progressText = document.getElementById('mapa-loading-text');
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (progressText) progressText.textContent = `Procesando ${procesados} de ${total} registros...`;
    }

    loadingOverlay.remove();

    if (pines.length === 0) {
      api.env.showNotification('No se pudo geolocalizar ninguna dirección de forma exitosa en OpenStreetMap.', 'warning');
      return;
    }

    api.env.showNotification(`Georreferenciación exitosa: Se ubicaron ${pines.length} de ${total} registros.`, 'success');
    abrirModalUnifiedWithPines(tituloTabla, pines);
  };

  const abrirModalUnifiedWithPines = (tituloTabla, pines) => {
    abrirModalMapaUnificado(tituloTabla, pines);
  };

  // Notificación de carga
  api.env.showNotification('🧩 Localizador Geográfico 🗺️ cargado correctamente', 'info');
  console.log('[Mapa] Plugin inicializado correctamente ✅');

})();
