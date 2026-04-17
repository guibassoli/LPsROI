/**
 * tracker.js — Tracking progressivo de leads para o Nucleo de Inteligencia.
 *
 * Carregado em toda pagina do funil. Envia eventos para
 * POST /public/tracking/* do Nucleo via API key opaca.
 *
 * Identificacao do lead: UUID gerado pelo /init no primeiro page load,
 * propagado entre paginas via querystring `lid=<uuid>`.
 *
 * Sem localStorage, sem cookies — tudo server-side.
 */
;(function () {
	'use strict'

	// ── Config ────────────────────────────────────────────────
	// Endpoint de tracking do Nucleo em prod (org ROI COM IA).
	var API_URL = 'https://core-api.roisemhype.cloud'
	var API_KEY = 'nuc_fff9044f65faaba73c66e3ee000b7531446cdb8b'

	// ── State ─────────────────────────────────────────────────
	var _leadId = null
	var _ready = false
	var _buffer = []
	var _leadInfo = { name: null, email: null, phone: null }
	var _utm = null
	var _pageLoadTime = Date.now()
	var _fieldDebounceTimers = {}
	var _flushTimer = null
	var _eventBatch = []
	var FLUSH_INTERVAL_MS = 3000
	var FLUSH_MAX_BATCH = 20

	// ── UTM ───────────────────────────────────────────────────
	function captureUtm() {
		var p = new URLSearchParams(window.location.search)
		var utm = {}
		var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']
		for (var i = 0; i < keys.length; i++) {
			var val = p.get(keys[i])
			if (val) utm[keys[i].replace('utm_', '')] = val
		}
		return Object.keys(utm).length > 0 ? utm : undefined
	}

	// ── HTTP ──────────────────────────────────────────────────
	function post(path, body, keepalive) {
		return fetch(API_URL + path, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-API-Key': API_KEY,
			},
			body: JSON.stringify(body),
			keepalive: !!keepalive,
		})
	}

	// ── Lead ID ───────────────────────────────────────────────
	function getLeadIdFromUrl() {
		return new URLSearchParams(window.location.search).get('lid')
	}

	function injectLeadId(url) {
		if (!_leadId) return url
		try {
			var u = new URL(url, window.location.origin)
			u.searchParams.set('lid', _leadId)
			return u.pathname + u.search + u.hash
		} catch (e) {
			if (url.indexOf('?') === -1) return url + '?lid=' + _leadId
			return url + '&lid=' + _leadId
		}
	}

	// ── Init ──────────────────────────────────────────────────
	function init() {
		_utm = captureUtm()
		var lid = getLeadIdFromUrl()

		if (lid) {
			_leadId = lid
			_ready = true
			trackPageView()
			startFlushTimer()
			return
		}

		post('/public/tracking/init', {
			pageUrl: window.location.href,
			referrer: document.referrer || undefined,
			userAgent: navigator.userAgent,
			utm: _utm,
		})
			.then(function (r) { return r.json() })
			.then(function (data) {
				_leadId = data.leadId
				_ready = true
				flushBuffer()
				trackPageView()
				startFlushTimer()
			})
			.catch(function (err) {
				console.warn('[tracker] init falhou — tracking desativado:', err.message || err)
			})
	}

	// ── Buffer / Batch ────────────────────────────────────────
	function flushBuffer() {
		if (_buffer.length === 0) return
		for (var i = 0; i < _buffer.length; i++) {
			_buffer[i].leadId = _leadId
			_eventBatch.push(_buffer[i])
		}
		_buffer = []
		if (_eventBatch.length >= FLUSH_MAX_BATCH) flushBatch(false)
	}

	function flushBatch(keepalive) {
		if (_eventBatch.length === 0) return
		var toSend = _eventBatch.slice()
		_eventBatch = []
		post('/public/tracking/events', toSend, keepalive).catch(function (err) {
			console.warn('[tracker] flush falhou:', err.message || err)
		})
	}

	function startFlushTimer() {
		if (_flushTimer) return
		_flushTimer = setInterval(function () {
			flushBatch(false)
		}, FLUSH_INTERVAL_MS)
	}

	// ── Track ─────────────────────────────────────────────────
	function buildEvent(event, data) {
		var evt = {
			leadId: _leadId,
			event: event,
			data: data || undefined,
			pageUrl: window.location.href,
			userAgent: navigator.userAgent,
			utm: _utm,
		}
		if (_leadInfo.name) evt.name = _leadInfo.name
		if (_leadInfo.email) evt.email = _leadInfo.email
		if (_leadInfo.phone) evt.phone = _leadInfo.phone
		return evt
	}

	function track(event, data) {
		var evt = buildEvent(event, data)
		if (!_ready) {
			_buffer.push(evt)
			return
		}
		_eventBatch.push(evt)
		if (_eventBatch.length >= FLUSH_MAX_BATCH) flushBatch(false)
	}

	function trackNow(event, data) {
		var evt = buildEvent(event, data)
		if (!_ready) {
			_buffer.push(evt)
			return
		}
		post('/public/tracking/events', evt, false).catch(function (err) {
			console.warn('[tracker] trackNow falhou:', err.message || err)
		})
	}

	function trackPageView() {
		track('page_view', {
			title: document.title,
			referrer: document.referrer || undefined,
			screen: window.screen.width + 'x' + window.screen.height,
			viewport: window.innerWidth + 'x' + window.innerHeight,
		})
	}

	// ── Field tracking (debounced) ────────────────────────────
	function trackField(fieldName, value) {
		if (_fieldDebounceTimers[fieldName]) clearTimeout(_fieldDebounceTimers[fieldName])
		_fieldDebounceTimers[fieldName] = setTimeout(function () {
			track('form_field_changed', { field: fieldName, length: (value || '').length })
		}, 300)
	}

	function trackFieldCompleted(fieldName, value) {
		if (_fieldDebounceTimers[fieldName]) {
			clearTimeout(_fieldDebounceTimers[fieldName])
			delete _fieldDebounceTimers[fieldName]
		}
		track('form_field_completed', { field: fieldName, value: value })
	}

	// ── Lead info (progressive enrichment) ────────────────────
	function setLeadInfo(info) {
		if (info.name) _leadInfo.name = info.name
		if (info.email) _leadInfo.email = info.email
		if (info.phone) _leadInfo.phone = info.phone
	}

	// ── Page leave ────────────────────────────────────────────
	function onPageLeave() {
		var timeOnPage = Math.round((Date.now() - _pageLoadTime) / 1000)
		var evt = buildEvent('page_left', {
			timeOnPageSeconds: timeOnPage,
			scrollDepth: Math.round(
				((window.scrollY + window.innerHeight) / document.documentElement.scrollHeight) * 100
			),
		})
		// Flush tudo de uma vez com keepalive (sobrevive ao unload)
		_eventBatch.push(evt)
		flushBatch(true)
	}

	document.addEventListener('visibilitychange', function () {
		if (document.visibilityState === 'hidden') onPageLeave()
	})

	// ── Public API ────────────────────────────────────────────
	window.__tracker = {
		track: track,
		trackNow: trackNow,
		trackField: trackField,
		trackFieldCompleted: trackFieldCompleted,
		setLeadInfo: setLeadInfo,
		getLeadId: function () { return _leadId },
		injectLeadId: injectLeadId,
		flush: function () { flushBatch(false) },
	}

	// ── Boot ──────────────────────────────────────────────────
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init)
	} else {
		init()
	}
})()
