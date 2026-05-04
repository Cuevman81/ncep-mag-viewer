document.addEventListener('DOMContentLoaded', () => {
    // ============================================================================
    // MODEL CONFIGURATION
    // ----------------------------------------------------------------------------
    // Verified against live mag.ncep.noaa.gov as of 2026-05.
    //   nested: GFS uses /data/{model}/{cyc}/{area}/{param}/{file}.gif
    //           others use FLAT /data/{model}/{cyc}/{file}.gif
    //   hourFmt 'HHHMM' is HRRR-only (sub-hourly graphics, hour stored as hhh + 00)
    //   hourBands describe the actual cadence on MAG (GFS thins past 120h, GEFS past 180h)
    //   areas list only what MAG actually serves for that model
    // ============================================================================
    const modelConfig = {
        gfs: {
            label: 'GFS',
            cycles: ['00', '06', '12', '18'],
            nested: true,
            hourFmt: 'HHH',
            hourBands: [{ from: 0, to: 120, step: 3 }, { from: 123, to: 240, step: 3 }, { from: 252, to: 384, step: 12 }],
            areas: ['namer', 'conus'],
            defaultArea: 'namer',
            runDuration: 5.0 // GFS 384h takes ~5 hours to fully appear on MAG
        },
        nam: {
            label: 'NAM',
            cycles: ['00', '06', '12', '18'],
            nested: false,
            hourFmt: 'HHH',
            hourBands: [{ from: 0, to: 84, step: 3 }],
            areas: ['namer', 'conus'],
            defaultArea: 'namer',
            runDuration: 2.5 // NAM 84h takes ~2.5 hours
        },
        hrrr: {
            label: 'HRRR',
            cycles: ['00','01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23'],
            nested: false,
            hourFmt: 'HHHMM',
            hourBands: [{ from: 0, to: 48, step: 1 }],
            areas: ['conus'],
            defaultArea: 'conus',
            extendedCycles: ['00', '06', '12', '18'],
            shortMaxHour: 18,
            runDuration: 1.5 // HRRR takes ~1.5 hours
        },
        sref: {
            label: 'SREF',
            cycles: ['03', '09', '15', '21'],
            nested: false,
            hourFmt: 'HHH',
            hourBands: [{ from: 0, to: 87, step: 3 }],
            areas: ['namer'],
            defaultArea: 'namer',
            runDuration: 4.0 // SREF is slow
        },
        'gefs-mean-sprd': {
            label: 'GEFS Mean/Spread',
            cycles: ['00', '06', '12', '18'],
            nested: false,
            hourFmt: 'HHH',
            hourBands: [{ from: 0, to: 180, step: 6 }, { from: 192, to: 384, step: 12 }],
            areas: ['namer', 'conus'],
            defaultArea: 'namer',
            runDuration: 6.0 // GEFS is the slowest
        },
        rap: {
            label: 'RAP',
            cycles: ['00','01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23'],
            nested: false,
            hourFmt: 'HHH',
            hourBands: [{ from: 0, to: 51, step: 1 }],
            areas: ['conus', 'namer'],
            defaultArea: 'conus',
            runDuration: 1.5
        }
    };

    const areaLabels = {
        namer: 'NAMER (North America)',
        conus: 'CONUS'
    };

    const levels = [
        { id: 'sfc',   name: 'Surface' },
        { id: 'thick', name: '1000-500mb Thickness' },
        { id: '925',   name: '925mb' },
        { id: '850',   name: '850mb' },
        { id: '700',   name: '700mb' },
        { id: '500',   name: '500mb' },
        { id: '300',   name: '300mb' }
    ];

    // ============================================================================
    // PARAMETER → LEVEL AVAILABILITY
    // ----------------------------------------------------------------------------
    // A cell is enabled iff its (param, level) returns a string here.
    // The string is the actual MAG product folder/file token (without model/area/hr).
    // 'temp_ht' is the "Smart Profile" mode and intentionally returns a level-
    // appropriate product for every level (vorticity at 500, RH at 700, wind at 300...).
    // ============================================================================
    const productMap = {
        // SMART PROFILE — show the operationally most useful chart per level
        temp_ht: {
            sfc:   '10m_wnd_precip',
            thick: '1000_500_thick',
            '925': '925_temp_ht',
            '850': '850_temp_ht',
            '700': '700_rh_ht',
            '500': '500_vort_ht',
            '300': '300_wnd_ht'
        },
        vort_ht: {
            '500': '500_vort_ht',
            '850': '850_vort_ht'
        },
        rh_ht: {
            '925': '925_rh_ht',
            '850': '850_rh_ht',
            '700': '700_rh_ht',
            '500': '500_rh_ht'
        },
        wnd_ht: {
            sfc:   '10m_wnd_precip',
            '925': '925_wnd_ht',
            '850': '850_wnd_ht',
            '700': '700_wnd_ht',
            '500': '500_wnd_ht',
            '300': '300_wnd_ht'
        },
        precip: {
            sfc: 'precip_p03'
        }
    };

    // ============================================================================
    // PER-MODEL PRODUCT OVERRIDES
    // ----------------------------------------------------------------------------
    // Each entry maps the GFS/NAM "canonical" product name to either:
    //   - a different string  → use that product instead (file-naming differs)
    //   - null                → product not produced for this model; disable cell
    // Verified against MAG cycle-fhrs.php for each model+region.
    // ============================================================================
    const modelOverrides = {
        gfs: {
            '925_rh_ht': null,
            '925_wnd_ht': null, '850_wnd_ht': null, '700_wnd_ht': null
        },
        nam: {
            '925_rh_ht': null,
            '925_wnd_ht': null, '850_wnd_ht': null, '700_wnd_ht': null
        },
        hrrr: {
            // HRRR uses _wnd, not _wnd_ht, for upper-air winds
            '300_wnd_ht': '300_wnd',
            // HRRR has no plain 925_temp_ht; closest analog is 925_temp_wnd
            '925_temp_ht': '925_temp_wnd',
            // HRRR surface composites differ
            '10m_wnd_precip':       '2m_temp_10m_wnd',
            '850_temp_mslp_precip': '2m_temp_10m_wnd',
            // HRRR doesn't carry these
            '850_vort_ht': null,
            '925_rh_ht': null, '850_rh_ht': null, '500_rh_ht': null,
            '925_wnd_ht': null, '850_wnd_ht': null, '700_wnd_ht': null, '500_wnd_ht': null
        },
        sref: {
            // SREF NAMER uses _temp (no _ht) for thermal upper-air
            '850_temp_ht':           '850_temp',
            '700_temp_ht':           '700_temp',
            '850_temp_mslp_precip':  '850_temp',  // surface composite fallback
            '10m_wnd_precip':        '10m_wind',
            // SREF has no 925 anything, no RH/wind aside from 10m, only vort at 500
            '925_temp_ht': null, '925_rh_ht': null, '925_wnd_ht': null,
            '850_rh_ht': null, '850_wnd_ht': null, '850_vort_ht': null,
            '700_rh_ht': null, '700_wnd_ht': null,
            '500_temp_ht': null, '500_rh_ht': null, '500_wnd_ht': null,
            '300_wnd_ht': null
        },
        'gefs-mean-sprd': {
            '850_temp_ht':           '850_temp',
            '700_temp_ht':           '700_temp',
            '500_temp_ht':           '500_temp',
            '850_temp_mslp_precip':  'mslp',
            '10m_wnd_precip':        '10m_wnd',
            // GEFS mean/spread carries no RH or wind layers above the surface, no 925
            '925_temp_ht': null, '925_rh_ht': null, '925_wnd_ht': null,
            '850_rh_ht': null, '850_wnd_ht': null, '850_vort_ht': null,
            '700_rh_ht': null, '700_wnd_ht': null,
            '500_rh_ht': null, '500_wnd_ht': null,
            '300_wnd_ht': null,
            '1000_500_thick': null
        },
        rap: {
            // RAP has no upper-level surface composite — substitute the 2m/10m chart
            '850_temp_mslp_precip':  '2m_temp_10m_wnd',
            '10m_wnd_precip':        '2m_temp_10m_wnd',
            // RAP precip is hourly, not 3h
            'precip_p03':            'precip_p01',
            // RAP doesn't carry these on NAMER
            '925_rh_ht': null, '925_wnd_ht': null,
            '850_rh_ht': null, '850_wnd_ht': null, '850_vort_ht': null,
            '700_temp_ht': null, '700_wnd_ht': null,
            '500_rh_ht': null, '500_wnd_ht': null
        }
    };

    // ============================================================================
    // SMART PROFILE FALLBACKS
    // ----------------------------------------------------------------------------
    // Used ONLY when the parameter dropdown is "Smart Profile" (temp_ht). Lets
    // the curated default chart at a level fall back to a different available
    // chart per model — without affecting explicit parameter selections.
    // (e.g. SREF has no 700mb RH, so Smart Profile substitutes 700mb temperature;
    //  but if the user explicitly picks "Relative Humidity", 700 stays disabled.)
    // ============================================================================
    const smartProfileFallbacks = {
        sref:             { '700_rh_ht': '700_temp' },
        'gefs-mean-sprd': { '700_rh_ht': '700_temp' }
    };

    // ============================================================================
    // DOM HOOKS
    // ============================================================================
    const gridContainer    = document.getElementById('hoverGridContainer');
    const modelImage       = document.getElementById('modelImage');
    const placeholder      = document.getElementById('placeholder');
    const loadingSpinner   = document.getElementById('loadingSpinner');
    const errorMsg         = document.getElementById('errorMsg');
    const modelSelect      = document.getElementById('modelSelect');
    const regionSelect     = document.getElementById('regionSelect');
    const cycleSelect      = document.getElementById('cycleSelect');
    const paramSelect      = document.getElementById('paramSelect');
    const statusLog        = document.getElementById('statusLog');
    const clearLogBtn      = document.getElementById('clearLog');
    const runStatusText    = document.getElementById('runStatusText');
    const runProgressBar   = document.getElementById('runProgressBar');
    const progressDot      = document.getElementById('progressIndicator');

    let currentCell        = null;
    let imageCache         = new Map();
    let currentLoadingUrl  = null;
    let progressScanToken  = 0;

    // ============================================================================
    // PERSISTENCE
    // ============================================================================
    function saveSelections() {
        try {
            localStorage.setItem('ncep_selections', JSON.stringify({
                model:  modelSelect.value,
                region: regionSelect.value,
                cycle:  cycleSelect.value,
                param:  paramSelect.value
            }));
        } catch (_) {}
    }
    function loadSelections() {
        try { return JSON.parse(localStorage.getItem('ncep_selections') || '{}'); }
        catch (_) { return {}; }
    }

    // ============================================================================
    // INIT
    // ============================================================================
    const saved = loadSelections();
    if (saved.model && modelConfig[saved.model]) modelSelect.value = saved.model;
    if (saved.param) paramSelect.value = saved.param;

    refreshAreaOptions(saved.region);
    refreshCycleOptions(saved.cycle);
    buildGrid();
    updateCellAvailability();
    log('Ready.');
    setTimeout(checkRunProgress, 300);

    // ============================================================================
    // LOG
    // ============================================================================
    function log(msg, type = 'info') {
        const entry = document.createElement('div');
        entry.classList.add('log-entry');
        if (type !== 'info') entry.classList.add(type);
        const t = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        entry.textContent = `[${t}] ${msg}`;
        statusLog.prepend(entry);
        while (statusLog.children.length > 50) statusLog.lastChild.remove();
    }
    clearLogBtn.addEventListener('click', () => {
        statusLog.innerHTML = '<div class="log-entry">Log cleared.</div>';
    });

    // ============================================================================
    // DROPDOWN POPULATION
    // ============================================================================
    function refreshAreaOptions(preferred) {
        const cfg = modelConfig[modelSelect.value];
        const previous = regionSelect.value;
        regionSelect.innerHTML = '';
        cfg.areas.forEach(a => {
            const opt = document.createElement('option');
            opt.value = a;
            opt.textContent = areaLabels[a] || a.toUpperCase();
            regionSelect.appendChild(opt);
        });
        const want = preferred || previous;
        regionSelect.value = cfg.areas.includes(want) ? want : cfg.defaultArea;
    }

    function refreshCycleOptions(preferred) {
        const cfg = modelConfig[modelSelect.value];
        const previous = cycleSelect.value;
        cycleSelect.innerHTML = '';
        cfg.cycles.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = `${c}z`;
            cycleSelect.appendChild(opt);
        });
        const want = preferred || previous;
        if (cfg.cycles.includes(want)) {
            cycleSelect.value = want;
        } else {
            // Pick the most recent cycle whose UTC hour has already passed
            const nowH = new Date().getUTCHours();
            let best = cfg.cycles[0];
            for (const c of cfg.cycles) {
                if (parseInt(c, 10) <= nowH) best = c;
            }
            cycleSelect.value = best;
        }
    }

    // ============================================================================
    // FORECAST HOUR ENUMERATION
    // ============================================================================
    function getHoursForCycle() {
        const cfg = modelConfig[modelSelect.value];
        let bands = cfg.hourBands;
        // HRRR: only 00/06/12/18z extend to 48h; other cycles only 18h
        if (modelSelect.value === 'hrrr' && !cfg.extendedCycles.includes(cycleSelect.value)) {
            bands = [{ from: 0, to: cfg.shortMaxHour, step: 1 }];
        }
        const hours = [];
        for (const b of bands) {
            for (let h = b.from; h <= b.to; h += b.step) hours.push(h);
        }
        return hours;
    }
    function getMaxHour() {
        const hrs = getHoursForCycle();
        return hrs[hrs.length - 1];
    }
    // Format an integer forecast hour into the model's filename hour token
    function fmtHour(h) {
        const fmt = modelConfig[modelSelect.value].hourFmt;
        if (fmt === 'HHHMM') return String(h).padStart(3, '0') + '00';
        return String(h).padStart(3, '0');
    }

    // ============================================================================
    // GRID
    // ============================================================================
    function buildGrid() {
        gridContainer.innerHTML = '';
        const hours = getHoursForCycle();

        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        const corner = document.createElement('th');
        corner.textContent = 'Level';
        headerRow.appendChild(corner);
        hours.forEach(h => {
            const th = document.createElement('th');
            th.textContent = `+${h}h`;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        levels.forEach(level => {
            const tr = document.createElement('tr');
            const rowH = document.createElement('th');
            rowH.textContent = level.name;
            tr.appendChild(rowH);
            hours.forEach(h => {
                const td = document.createElement('td');
                td.classList.add('hoverable');
                td.dataset.level = level.id;
                td.dataset.hour  = String(h);
                td.tabIndex = 0;
                td.addEventListener('mouseenter', handleCellHover);
                td.addEventListener('click', handleCellClick);
                td.addEventListener('focus', handleCellHover);
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        gridContainer.appendChild(table);
    }

    // Resolve the MAG product token for a (param, level) pair, applying model-specific overrides.
    function resolveProduct(param, level) {
        const base = (productMap[param] || {})[level];
        if (!base) return null;
        const m = modelSelect.value;
        // Smart Profile gets a higher-priority fallback table so it can substitute
        // a different chart when the curated default isn't carried by this model.
        if (param === 'temp_ht') {
            const sf = smartProfileFallbacks[m];
            if (sf && sf.hasOwnProperty(base)) return sf[base];
        }
        const overrides = modelOverrides[m];
        if (overrides && overrides.hasOwnProperty(base)) return overrides[base];
        return base;
    }

    function updateCellAvailability() {
        const param = paramSelect.value;
        document.querySelectorAll('td.hoverable').forEach(td => {
            const level = td.dataset.level;
            const hour = td.dataset.hour;
            
            let product = resolveProduct(param, level);
            
            // Special case: Precipitation doesn't exist at hour 0
            if (param === 'precip' && hour === '0') product = null;

            const disabled = !product;
            td.classList.toggle('disabled', disabled);
            td.title = disabled
                ? `${param} not available at ${level} for ${modelSelect.value.toUpperCase()}`
                : `${product}  +${hour}h  (click to open full size)`;
        });
    }

    // ============================================================================
    // URL BUILDER
    // ============================================================================
    function buildImageUrl(level, hour) {
        const model  = modelSelect.value;
        const region = regionSelect.value;
        const cycle  = cycleSelect.value;
        const param  = paramSelect.value;
        const cfg    = modelConfig[model];

        const product = resolveProduct(param, level);
        if (!product) return null;

        const hourTok = fmtHour(parseInt(hour, 10));
        const filename = `${model}_${region}_${hourTok}_${product}.gif`;

        if (cfg.nested) {
            // GFS-style: data/{model}/{cyc}/{area}/{product}/{file}
            return `https://mag.ncep.noaa.gov/data/${model}/${cycle}/${region}/${product}/${filename}`;
        }
        return `https://mag.ncep.noaa.gov/data/${model}/${cycle}/${filename}`;
    }

    // ============================================================================
    // INTERACTION
    // ============================================================================
    function handleCellHover(e) {
        const cell = e.currentTarget;
        if (cell.classList.contains('disabled')) return;
        if (currentCell) currentCell.classList.remove('active');
        currentCell = cell;
        cell.classList.add('active');
        loadImageForCell(cell);
    }
    function handleCellClick(e) {
        const cell = e.currentTarget;
        if (cell.classList.contains('disabled')) return;
        const url = buildImageUrl(cell.dataset.level, cell.dataset.hour);
        if (url) window.open(url, '_blank', 'noopener');
    }

    // Arrow-key navigation
    document.addEventListener('keydown', (e) => {
        if (!currentCell || ['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;
        const dir = { ArrowLeft: [0,-1], ArrowRight: [0,1], ArrowUp: [-1,0], ArrowDown: [1,0] }[e.key];
        if (!dir) return;
        e.preventDefault();
        const row = currentCell.parentElement;
        const tbody = row.parentElement;
        const colIdx = Array.from(row.children).indexOf(currentCell);
        const rowIdx = Array.from(tbody.children).indexOf(row);
        const targetRow = tbody.children[rowIdx + dir[0]];
        if (!targetRow) return;
        const target = targetRow.children[colIdx + dir[1]];
        if (!target || !target.classList.contains('hoverable')) return;
        currentCell.classList.remove('active');
        currentCell = target;
        target.classList.add('active');
        target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        loadImageForCell(target);
    });

    // ============================================================================
    // CONTROL CHANGE WIRING
    // ============================================================================
    modelSelect.addEventListener('change', () => {
        refreshAreaOptions();
        refreshCycleOptions();
        buildGrid();
        updateCellAvailability();
        currentCell = null;
        placeholder.classList.add('active');
        modelImage.classList.remove('loaded');
        saveSelections();
        checkRunProgress();
    });
    cycleSelect.addEventListener('change', () => {
        // For HRRR the grid range depends on cycle (full vs short forecast)
        if (modelSelect.value === 'hrrr') {
            buildGrid();
            updateCellAvailability();
            currentCell = null;
        }
        if (currentCell) loadImageForCell(currentCell);
        saveSelections();
        checkRunProgress();
    });
    regionSelect.addEventListener('change', () => {
        if (currentCell) loadImageForCell(currentCell);
        saveSelections();
        checkRunProgress();
    });
    paramSelect.addEventListener('change', () => {
        updateCellAvailability();
        if (currentCell && !currentCell.classList.contains('disabled')) loadImageForCell(currentCell);
        saveSelections();
    });

    // ============================================================================
    // IMAGE LOADER
    // ============================================================================
    function loadImageForCell(cell) {
        const url = buildImageUrl(cell.dataset.level, cell.dataset.hour);
        if (!url) {
            errorMsg.textContent = 'Parameter not available at this level for this model.';
            errorMsg.classList.add('active');
            return;
        }
        log(url.split('/').pop());
        displayImage(url);
    }
    function displayImage(url) {
        if (currentLoadingUrl === url) return;
        currentLoadingUrl = url;
        placeholder.classList.remove('active');
        errorMsg.classList.remove('active');
        if (!imageCache.has(url)) {
            loadingSpinner.classList.add('active');
            modelImage.classList.remove('loaded');
        }
        const img = new Image();
        img.src = url;
        img.onload = () => {
            if (currentLoadingUrl !== url) return;
            modelImage.src = url;
            modelImage.classList.add('loaded');
            loadingSpinner.classList.remove('active');
            imageCache.set(url, true);
            log('✓ ' + url.split('/').pop(), 'success');
        };
        img.onerror = () => {
            if (currentLoadingUrl !== url) return;
            modelImage.src = '';
            modelImage.classList.remove('loaded');
            loadingSpinner.classList.remove('active');
            errorMsg.textContent = 'Image not yet available for this hour.';
            errorMsg.classList.add('active');
            log('✗ ' + url.split('/').pop(), 'error');
        };
    }

    // ============================================================================
    // RUN PROGRESS — probes the actual maximum forecast hour available
    //   Strategy: pick a canary product known to exist at every hour for the
    //   selected model, then binary-search the highest hour that returns 200.
    // ============================================================================
    function getCanaryProduct() {
        const m = modelSelect.value;
        // Use a level/product combination known to be produced for every hour
        if (m === 'hrrr')           return { level: '500', product: '500_vort_ht' };
        if (m === 'sref')           return { level: '500', product: '500_vort_ht' };
        if (m === 'gefs-mean-sprd') return { level: '500', product: '500_vort_ht' };
        if (m === 'rap')            return { level: '500', product: '500_vort_ht' };
        if (m === 'nam')            return { level: '500', product: '500_vort_ht' };
        return { level: '500', product: '500_vort_ht' }; // gfs
    }

    function buildCanaryUrl(hourInt) {
        const model  = modelSelect.value;
        const region = regionSelect.value;
        const cycle  = cycleSelect.value;
        const cfg    = modelConfig[model];
        const { product } = getCanaryProduct();
        const hourTok = fmtHour(hourInt);
        const filename = `${model}_${region}_${hourTok}_${product}.gif`;
        return cfg.nested
            ? `https://mag.ncep.noaa.gov/data/${model}/${cycle}/${region}/${product}/${filename}`
            : `https://mag.ncep.noaa.gov/data/${model}/${cycle}/${filename}`;
    }

    function probeHour(hourInt) {
        return new Promise(resolve => {
            const img = new Image();
            const url = buildCanaryUrl(hourInt);
            img.onload  = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = url;
        });
    }

    // The selected cycle resolves to its most recent UTC occurrence:
    // if its hour is later than the current UTC hour, it must be from yesterday.
    function resolveRunDate() {
        const cycleHr = parseInt(cycleSelect.value, 10);
        const now = new Date();
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        if (cycleHr > now.getUTCHours()) d.setUTCDate(d.getUTCDate() - 1);
        return d;
    }
    function formatRunDate(d) {
        // e.g. "Mon May 3" — UTC, since cycles are in UTC
        return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    }
    function runLabel() {
        // "12z Mon May 3"
        return `${cycleSelect.value}z ${formatRunDate(resolveRunDate())}`;
    }

    async function checkRunProgress() {
        const myToken = ++progressScanToken;
        const model = modelSelect.value;
        const cycle = cycleSelect.value;
        const hours = getHoursForCycle();
        const maxH  = hours[hours.length - 1];
        const label = runLabel();
        const cfg   = modelConfig[model];

        runStatusText.textContent = `Scanning ${cfg.label} ${label}...`;
        progressDot.className = 'dot scanning';
        runProgressBar.style.width = '0%';

        // Step 1: Probe the start (0h) and the end (maxH)
        const has0 = await probeHour(0);
        if (myToken !== progressScanToken) return;
        
        const hasMax = await probeHour(maxH);
        if (myToken !== progressScanToken) return;

        // Determine if the "Complete" status is actually today's run or yesterday's stale data
        const now = new Date();
        const cycleHr = parseInt(cycle, 10);
        
        // Calculate how many hours have passed since today's cycle started (in UTC)
        let hoursSinceCycle = now.getUTCHours() + (now.getUTCMinutes() / 60) - cycleHr;
        if (hoursSinceCycle < 0) hoursSinceCycle += 24; 

        const isSuspiciouslyComplete = hasMax && (hoursSinceCycle < cfg.runDuration);

        if (!has0) {
            runStatusText.textContent = `${label} not yet available`;
            progressDot.className = 'dot offline';
            runProgressBar.style.width = '0%';
            log(`${model.toUpperCase()} ${label}: no 000h yet`);
        } else if (isSuspiciouslyComplete) {
            runStatusText.textContent = `${label} — Stale / Yesterday's Data`;
            progressDot.className = 'dot offline';
            runProgressBar.style.width = '100%';
            log(`${model.toUpperCase()} ${label}: Seeing stale 384h from yesterday`, 'error');
        } else if (hasMax) {
            runStatusText.textContent = `${label} — complete (out to ${maxH}h)`;
            progressDot.className = 'dot online';
            runProgressBar.style.width = '100%';
            log(`${model.toUpperCase()} ${label}: complete to ${maxH}h`, 'success');
        } else {
            // Binary-search the actual reach over the hour grid
            let lo = 0;
            let hi = hours.length - 1;
            while (lo + 1 < hi) {
                const mid = (lo + hi) >> 1;
                const ok = await probeHour(hours[mid]);
                if (myToken !== progressScanToken) return;
                if (ok) lo = mid; else hi = mid;
            }
            const reached = hours[lo];
            const pct = Math.max(5, Math.round((reached / maxH) * 100));
            runStatusText.textContent = `${label} — in progress (out to ${reached}h of ${maxH}h)`;
            progressDot.className = 'dot processing';
            runProgressBar.style.width = `${pct}%`;
            log(`${model.toUpperCase()} ${label}: ${reached}h of ${maxH}h available`);
        }
    }
});
