document.addEventListener('DOMContentLoaded', () => {
    // ============================================================================
    // MODEL CONFIGURATION
    // ----------------------------------------------------------------------------
    // Verified against live mag.ncep.noaa.gov (MAG 7.1.0) on 2026-11-20.
    //   nested: GFS uses /data/{model}/{cyc}/{area}/{param}/{file}.gif
    //           others use FLAT /data/{model}/{cyc}/{file}.gif
    //   hourFmt 'HHHMM' is HRRR-only (sub-hourly graphics, hour stored as hhh + 00)
    //   hourBands describe the cadence the viewer uses (GEFS thins past 180h, GFS past
    //           120h; MAG has GFS hourly to 120h but the grid keeps 3-hourly there)
    //   areas list only what MAG actually serves for that model
    // MAG 7.1.0 (Nov 2026) removed NAM and SREF (NWS SCN 26-47); RRFS replaces NAM.
    // ============================================================================
    // MAG regions. US_SECTORS are the CONUS sub-sectors the hi-res models plot;
    // GLOBAL_AREAS are the domains GFS/AIGFS plot (GEFS has all but two).
    const US_SECTORS   = ['us-se', 'us-sc', 'us-ne', 'us-nc', 'us-nw', 'us-sw'];
    const GLOBAL_AREAS = ['namer', 'conus', 'alaska', 'us-samoa', 'east-pac', 'west-atl', 'atlantic',
                          'north-pac', 'south-pac', 'pac-region', 'samer', 'europe', 'africa', 'asia',
                          'india', 'arctic', 'polar'];
    const HRRR_AK_CYCLES = ['00', '03', '06', '09', '12', '15', '18', '21'];

    const modelConfig = {
        gfs: {
            label: 'GFS',
            cycles: ['00', '06', '12', '18'],
            nested: true,
            hourFmt: 'HHH',
            hourBands: [{ from: 0, to: 120, step: 3 }, { from: 123, to: 240, step: 3 }, { from: 252, to: 384, step: 12 }],
            areas: GLOBAL_AREAS,
            defaultArea: 'namer',
            defaultDensity: 12, // 93 native columns is too wide; open at 12h (~33 cols) so it fits without scroll
            runDuration: 5.0, // GFS 384h takes ~5 hours to fully appear on MAG
            // Past 240h GFS is 12-hourly and MAG only plots 12h/24h precip there
            lateHourProducts: { from: 252, map: { 'precip_p03': 'precip_p12' } },
            noPrecipAreas: ['polar'] // MAG plots no GFS precip on the Polar domain
        },
        aigfs: {
            label: 'AIGFS',
            cycles: ['00', '06', '12', '18'],
            nested: false,
            hourFmt: 'HHH',
            hourBands: [{ from: 0, to: 384, step: 6 }],
            areas: GLOBAL_AREAS,
            defaultArea: 'namer',
            defaultDensity: 12, // 65 native columns out to 384h; open at 12h so it fits without scroll
            // 000h lands ~4h21m-4h36m after the cycle; 384h ~1h25m later for NAMER/CONUS/Europe,
            // up to ~2h35m later for the outer domains (Alaska, India, Samoa...) (MAG, Nov 2026)
            runDuration: 4.75,
            noPrecipAreas: ['polar'] // MAG 7.0.0: AIGFS precip is not plotted for the Polar domain
        },
        rrfs: {
            label: 'RRFS',
            cycles: ['00', '06', '12', '18'], // MAG only plots the 84h synoptic cycles
            nested: false,
            hourFmt: 'HHH',
            hourBands: [{ from: 0, to: 84, step: 1 }],
            areas: ['conus', ...US_SECTORS, 'alaska', 'hawaii', 'pr'], // AK/HI/PR run the same cycles and hours
            defaultArea: 'conus',
            defaultDensity: 3, // 85 hourly columns; open at 3h (29 cols) like NAM used to
            runDuration: 2.25 // 000h lands ~1h42m-2h01m after the cycle, 084h ~1h35m-1h50m later (MAG, Nov 2026)
        },
        hrrr: {
            label: 'HRRR',
            cycles: ['00','01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23'],
            nested: false,
            hourFmt: 'HHHMM',
            hourBands: [{ from: 0, to: 48, step: 1 }],
            areas: ['conus', ...US_SECTORS, 'alaska'],
            areaCycles: { alaska: HRRR_AK_CYCLES }, // HRRR-Alaska runs every 3h, not hourly
            defaultArea: 'conus',
            extendedCycles: ['00', '06', '12', '18'],
            shortMaxHour: 18,
            defaultDensity: 0, // 48 hourly cols — leave native, user can thin to 6/12h
            runDuration: 1.5 // HRRR takes ~1.5 hours
        },
        'gefs-mean-sprd': {
            label: 'GEFS Mean/Spread',
            cycles: ['00', '06', '12', '18'],
            nested: false,
            hourFmt: 'HHH',
            hourBands: [{ from: 0, to: 180, step: 6 }, { from: 192, to: 384, step: 12 }],
            areas: GLOBAL_AREAS.filter(a => a !== 'us-samoa' && a !== 'pac-region'),
            defaultArea: 'namer',
            defaultDensity: 12, // 47 native columns out to 384h; open at 12h so it fits without scroll
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
            extendedCycles: ['03', '09', '15', '21'], // NWS SCN 20-46 (RAPv5): 51h at these cycles, 21h at the rest
            shortMaxHour: 21,
            defaultDensity: 0, // 51 hourly cols — leave native, user can thin to 6/12h
            runDuration: 1.5,
            // 00/12z reach MAG ~1h35m-1h41m after the cycle, the rest by ~1h25m (MAG, Sep 2026)
            cycleRunDuration: { '00': 1.75, '12': 1.75 }
        }
    };

    // Region dropdown groups, in display order; a model shows only the areas it has.
    const areaGroups = [
        { label: 'United States', areas: {
            conus: 'CONUS', 'us-se': 'US Southeast', 'us-sc': 'US South Central', 'us-ne': 'US Northeast',
            'us-nc': 'US North Central', 'us-nw': 'US Northwest', 'us-sw': 'US Southwest',
            alaska: 'Alaska', hawaii: 'Hawaii', pr: 'Puerto Rico', 'us-samoa': 'American Samoa' } },
        { label: 'North America & oceans', areas: {
            namer: 'NAMER (North America)', 'east-pac': 'Eastern Pacific (S. US, Mexico)',
            'west-atl': 'Western Atlantic (SE US, Caribbean)', atlantic: 'Atlantic',
            'north-pac': 'North Pacific', 'south-pac': 'South Pacific', 'pac-region': 'Pacific (incl. far South Pacific)' } },
        { label: 'World', areas: {
            samer: 'South America', europe: 'Europe', africa: 'Africa', asia: 'Asia',
            india: 'India & Pakistan', arctic: 'Arctic', polar: 'North Polar' } }
    ];

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
    // Each entry maps the GFS "canonical" product name to either:
    //   - a different string  → use that product instead (file-naming differs)
    //   - null                → product not produced for this model; disable cell
    // Verified against MAG cycle-fhrs.php for each model+region.
    // ============================================================================
    const modelOverrides = {
        gfs: {
            '925_rh_ht': null,
            '925_wnd_ht': null, '850_wnd_ht': null, '700_wnd_ht': null
        },
        aigfs: {
            // AIGFS precip is 6-hourly only
            'precip_p03': 'precip_p06',
            '925_rh_ht': null,
            '925_wnd_ht': null, '850_wnd_ht': null, '700_wnd_ht': null
        },
        rrfs: {
            // RRFS precip_p03 exists only every 3rd hour; the hourly grid uses precip_p01
            'precip_p03': 'precip_p01',
            '925_rh_ht': null, '850_rh_ht': null, '500_rh_ht': null,
            '925_wnd_ht': null, '850_wnd_ht': null, '700_wnd_ht': null, '500_wnd_ht': null
        },
        hrrr: {
            // HRRR precip is hourly only (no precip_p03)
            'precip_p03': 'precip_p01',
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
        'gefs-mean-sprd': {
            '850_temp_ht':           '850_temp',
            '700_temp_ht':           '700_temp',
            '500_temp_ht':           '500_temp',
            '850_temp_mslp_precip':  'mslp',
            '10m_wnd_precip':        '10m_wnd',
            // GEFS winds are plain _wnd (no _ht); it has 250mb wind but not 300mb
            '925_wnd_ht':            '925_wnd',
            '850_wnd_ht':            '850_wnd',
            '700_wnd_ht':            '700_wnd',
            '500_wnd_ht':            '500_wnd',
            // GEFS precip is 6-hourly
            'precip_p03':            'precip_p06',
            // GEFS mean/spread carries no RH layers, no 925 temperature
            '925_temp_ht': null, '925_rh_ht': null,
            '850_rh_ht': null, '700_rh_ht': null, '500_rh_ht': null,
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
    // (e.g. GEFS has no 700mb RH, so Smart Profile substitutes 700mb temperature;
    //  but if the user explicitly picks "Relative Humidity", 700 stays disabled.)
    // ============================================================================
    const smartProfileFallbacks = {
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
    const densitySelect    = document.getElementById('densitySelect');
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
                model:   modelSelect.value,
                region:  regionSelect.value,
                cycle:   cycleSelect.value,
                param:   paramSelect.value,
                density: densitySelect.value
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
    // Models MAG has dropped. A returning visitor whose saved model is gone opens
    // on its replacement if it has one (NAM -> RRFS), otherwise on GFS.
    const replacedModels = { nam: 'rrfs' };
    const saved = loadSelections();
    if (replacedModels[saved.model]) saved.model = replacedModels[saved.model];
    if (saved.model && modelConfig[saved.model]) modelSelect.value = saved.model;
    if (!modelConfig[modelSelect.value]) modelSelect.value = 'gfs';
    if (saved.param) paramSelect.value = saved.param;

    refreshAreaOptions(saved.region);
    refreshCycleOptions(saved.cycle);
    refreshDensity(saved.density);
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
        for (const g of areaGroups) {
            const ids = Object.keys(g.areas).filter(a => cfg.areas.includes(a));
            if (!ids.length) continue;
            const group = document.createElement('optgroup');
            group.label = g.label;
            ids.forEach(a => {
                const opt = document.createElement('option');
                opt.value = a;
                opt.textContent = g.areas[a];
                group.appendChild(opt);
            });
            regionSelect.appendChild(group);
        }
        const want = preferred || previous;
        regionSelect.value = cfg.areas.includes(want) ? want : cfg.defaultArea;
    }

    // Cycles for the current model and region (HRRR-Alaska runs only every 3h).
    function cyclesFor(cfg) {
        return (cfg.areaCycles && cfg.areaCycles[regionSelect.value]) || cfg.cycles;
    }
    function refreshCycleOptions(preferred) {
        const cfg = modelConfig[modelSelect.value];
        const cycles = cyclesFor(cfg);
        const previous = cycleSelect.value;
        cycleSelect.innerHTML = '';
        cycles.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = `${c}z`;
            cycleSelect.appendChild(opt);
        });
        const want = preferred || previous;
        if (cycles.includes(want)) {
            cycleSelect.value = want;
        } else {
            // Pick the newest cycle past its cut-off (wrapping past 00Z). Before the
            // cut-off, that cycle's folder on MAG still holds yesterday's run.
            const now = new Date();
            const nowH = now.getUTCHours() + now.getUTCMinutes() / 60;
            let best = cycles[0], bestAge = Infinity;
            for (const c of cycles) {
                const age = (nowH - parseInt(c, 10) + 24) % 24;
                if (age >= runDurationFor(cfg, c) && age < bestAge) { best = c; bestAge = age; }
            }
            cycleSelect.value = best;
        }
    }

    // Set the Frame Density dropdown: use a saved/preferred value if valid,
    // otherwise fall back to the current model's defaultDensity.
    function refreshDensity(preferred) {
        const cfg = modelConfig[modelSelect.value];
        const valid = ['0', '3', '6', '12'];
        const want = (preferred !== undefined && preferred !== null) ? String(preferred) : null;
        densitySelect.value = (want !== null && valid.includes(want))
            ? want
            : String(cfg.defaultDensity || 0);
    }

    // ============================================================================
    // FORECAST HOUR ENUMERATION
    // ============================================================================
    function getHoursForCycle() {
        const cfg = modelConfig[modelSelect.value];
        let bands = cfg.hourBands;
        // HRRR (48h at 00/06/12/18z, else 18h) and RAP (51h at 03/09/15/21z, else 21h):
        // only the extended cycles run the full range
        if (cfg.extendedCycles && !cfg.extendedCycles.includes(cycleSelect.value)) {
            bands = [{ from: 0, to: cfg.shortMaxHour, step: 1 }];
        }
        const hours = [];
        for (const b of bands) {
            for (let h = b.from; h <= b.to; h += b.step) hours.push(h);
        }
        // Frame Density: thin the columns to multiples of the chosen cadence,
        // but always keep the first (0h) and the final forecast hour so the run's
        // full reach stays visible even when the max hour isn't a clean multiple
        // (e.g. RAP 51h).
        const density = parseInt(densitySelect.value, 10) || 0;
        if (!density) return hours;
        const last = hours[hours.length - 1];
        const thinned = hours.filter(h => h % density === 0);
        if (thinned[thinned.length - 1] !== last) thinned.push(last);
        return thinned;
    }
    // Hours after the cycle time used as the stale/complete cut-off. It has to
    // fall after the new run's first image reaches MAG (later is the safe side).
    function runDurationFor(cfg, cycle) {
        return (cfg.cycleRunDuration && cfg.cycleRunDuration[cycle]) || cfg.runDuration;
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
        corner.textContent = 'Level \\ +Hr';
        corner.title = 'Rows = pressure level · Columns = forecast hour';
        headerRow.appendChild(corner);
        hours.forEach(h => {
            const th = document.createElement('th');
            // Number-only header (e.g. "384") keeps columns narrow enough that the
            // coarse-cadence views fit without horizontal scrolling. Full "+384h"
            // text is preserved in the tooltip.
            th.textContent = String(h);
            th.title = `+${h}h forecast hour`;
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

    // Resolve the MAG product token for a (param, level, hour), applying model-specific overrides.
    function resolveProduct(param, level, hour) {
        const product = resolveBaseProduct(param, level);
        const cfg = modelConfig[modelSelect.value];
        if (product && product.startsWith('precip_') && (cfg.noPrecipAreas || []).includes(regionSelect.value)) return null;
        const late = cfg.lateHourProducts;
        if (product && late && parseInt(hour, 10) >= late.from && late.map[product]) return late.map[product];
        return product;
    }
    function resolveBaseProduct(param, level) {
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
            
            let product = resolveProduct(param, level, hour);
            
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

        const product = resolveProduct(param, level, hour);
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
        refreshDensity();
        buildGrid();
        updateCellAvailability();
        currentCell = null;
        currentLoadingUrl = null;
        placeholder.classList.add('active');
        modelImage.classList.remove('loaded');
        saveSelections();
        checkRunProgress();
    });
    cycleSelect.addEventListener('change', onCycleChange);
    function onCycleChange() {
        // For HRRR and RAP the grid range depends on cycle (full vs short forecast).
        // Rebuild it, keeping the hovered cell if its hour exists in the new range.
        if (modelConfig[modelSelect.value].extendedCycles) {
            const was = currentCell && { level: currentCell.dataset.level, hour: currentCell.dataset.hour };
            buildGrid();
            updateCellAvailability();
            currentCell = was && gridContainer.querySelector(`td[data-level="${was.level}"][data-hour="${was.hour}"]`);
            if (currentCell) {
                currentCell.classList.add('active');
            } else {
                placeholder.classList.add('active');
                modelImage.classList.remove('loaded');
                currentLoadingUrl = null;
            }
        }
        if (currentCell) loadImageForCell(currentCell);
        saveSelections();
        checkRunProgress();
    }
    regionSelect.addEventListener('change', () => {
        // A region with its own cycle list (HRRR-Alaska) may move the cycle; then
        // handle it as a cycle change (it rebuilds the grid and rescans).
        const cfg = modelConfig[modelSelect.value];
        if (cfg.areaCycles) {
            const before = cycleSelect.value;
            refreshCycleOptions();
            if (cycleSelect.value !== before) { updateCellAvailability(); onCycleChange(); return; }
        }
        // Some regions lack a product (no GFS/AIGFS precip on Polar), so re-grey the cells
        updateCellAvailability();
        if (currentCell) loadImageForCell(currentCell);
        saveSelections();
        checkRunProgress();
    });
    paramSelect.addEventListener('change', () => {
        updateCellAvailability();
        if (currentCell && !currentCell.classList.contains('disabled')) loadImageForCell(currentCell);
        saveSelections();
    });
    densitySelect.addEventListener('change', () => {
        // Rebuild the grid at the new cadence. The previously-active cell's
        // column may no longer exist, so reset the selection.
        buildGrid();
        updateCellAvailability();
        currentCell = null;
        currentLoadingUrl = null;
        placeholder.classList.add('active');
        modelImage.classList.remove('loaded');
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
            currentLoadingUrl = null;
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
            currentLoadingUrl = null; // let a re-hover retry it
        };
    }

    // ============================================================================
    // RUN PROGRESS — probes the actual maximum forecast hour available
    //   Strategy: pick a canary product known to exist at every hour for the
    //   selected model, then binary-search the highest hour that returns 200.
    // ============================================================================
    // 500mb vorticity is produced at every hour, in every area, for every model.
    function getCanaryProduct() {
        return { level: '500', product: '500_vort_ht' };
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

        const isSuspiciouslyComplete = hasMax && (hoursSinceCycle < runDurationFor(cfg, cycle));

        if (!has0) {
            runStatusText.textContent = `${label} not yet available`;
            progressDot.className = 'dot offline';
            runProgressBar.style.width = '0%';
            log(`${model.toUpperCase()} ${label}: no 000h yet`);
        } else if (isSuspiciouslyComplete) {
            runStatusText.textContent = `${label} — Stale / Yesterday's Data`;
            progressDot.className = 'dot offline';
            runProgressBar.style.width = '100%';
            log(`${model.toUpperCase()} ${label}: still yesterday's run (out to ${maxH}h)`, 'error');
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
