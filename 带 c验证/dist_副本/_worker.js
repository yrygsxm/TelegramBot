const WELCOME_MENU_TEXT = `喵~欢迎使用APPDO投稿机器人🤖
当你给本Bot发消息，会被转发到以上频道的创建者。
请问你有什么需求？`

const WELCOME_RESPONSES = {
  business: '如果你需要商务合作，请你带上你的商务类型向我发送消息，我将尽快回复您。',
  unban: '如果你想解封，请带上你的用户名（@EXAMPLE）和想解封的具体群向我发送消息。',
  usage: '如果你想直接联系频道主，请直接向我发送消息，我会把你的内容转发给频道创建者。',
}

const DEFAULTS = {
  webhookPath: '/endpoint',
  internalWeeklyReportPath: '/weekly-ban-report',
  verificationPagePath: '/verify',
  verificationSubmitPath: '/verify-submit',
  notifyIntervalMs: 3600 * 1000,
  startMsgUrl: 'https://raw.githubusercontent.com/yrygsxm/nfd/main/data/startMessage.md',
  notificationUrl: 'https://raw.githubusercontent.com/yrygsxm/nfd/main/data/notification.txt',
  defaultBlockMessage: '检测到违规内容，你已被封禁，无法继续与机器人对话。',
  manualBlockMessage: '你已被管理员封禁，无法继续与机器人对话。',
  banRulesKey: 'ban-rules',
  banStatsKey: 'ban-stats',
  captchaMaxAttempts: 3,
  adminPreviewLimit: 120,
  reportTimezoneLabel: 'Asia/Tokyo',
  reportTimezoneOffsetMs: 9 * 60 * 60 * 1000,
  maxBanStatsWeeks: 12,
  verificationSessionTtlMs: 30 * 60 * 1000,
}

const ADMIN_UI = {
  stateKey: 'admin-ui-state',
  pageSize: 8,
  command: '/permissions',
  nextPage: '➡️ 下一页',
  prevPage: '⬅️ 上一页',
  refresh: '🔄 刷新列表',
  close: '❌ 关闭',
  back: '↩️ 返回列表',
  setWhitelist: '⭐ 设为白名单',
  setBlacklist: '🚫 设为黑名单',
  setNormal: '👤 设为普通用户',
}

const BAN_RULES_UI = {
  pageSize: 5,
}

const CALLBACK_PREFIX = {
  welcome: 'welcome',
  permissionList: 'plist',
  permissionEdit: 'pedit',
  banRules: 'brules',
  autoUnban: 'aunban',
}

export default {
  async fetch(request, env, ctx) {
    const app = createBotApp(env)
    try {
      return await app.handleRequest(request, ctx)
    } catch (error) {
      console.error('fetch handler failed', error)
      return new Response('Internal Server Error', { status: 500 })
    }
  },

  async scheduled(controller, env, ctx) {
    const app = createBotApp(env)
    try {
      await app.handleScheduled(controller, ctx)
    } catch (error) {
      console.error('scheduled handler failed', error)
      throw error
    }
  },
}

function createBotApp(env) {
  const token = env.ENV_BOT_TOKEN
  const secret = env.ENV_BOT_SECRET
  const adminUid = String(env.ENV_ADMIN_UID || '')
  const webhookPath = env.WEBHOOK_PATH || DEFAULTS.webhookPath
  const internalWeeklyReportPath =
    env.INTERNAL_WEEKLY_REPORT_PATH || DEFAULTS.internalWeeklyReportPath
  const verificationPagePath =
    env.VERIFICATION_PAGE_PATH || DEFAULTS.verificationPagePath
  const verificationSubmitPath =
    env.VERIFICATION_SUBMIT_PATH || DEFAULTS.verificationSubmitPath
  const notifyIntervalMs = toPositiveNumber(
    env.NOTIFY_INTERVAL_MS,
    DEFAULTS.notifyIntervalMs
  )
  const notificationUrl = env.NOTIFICATION_URL || DEFAULTS.notificationUrl
  const startMsgUrl = env.START_MSG_URL || DEFAULTS.startMsgUrl
  const publicBaseUrl = String(env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
  const turnstileSiteKey = String(env.ENV_TURNSTILE_SITE_KEY || '').trim()
  const turnstileSecretKey = String(env.ENV_TURNSTILE_SECRET_KEY || '').trim()
  const hasTurnstileConfig = Boolean(turnstileSiteKey && turnstileSecretKey)
  const enableNotification = toBoolean(env.ENABLE_NOTIFICATION, true)
  const captchaEnabled = toBoolean(env.CAPTCHA_ENABLED, true)
  const captchaMaxAttempts = toPositiveNumber(
    env.CAPTCHA_MAX_ATTEMPTS,
    DEFAULTS.captchaMaxAttempts
  )
  const storage = env.nfd

  function ensureConfigured() {
    const missing = []
    if (!token) missing.push('ENV_BOT_TOKEN')
    if (!secret) missing.push('ENV_BOT_SECRET')
    if (!adminUid) missing.push('ENV_ADMIN_UID')
    if (!storage) missing.push('nfd KV binding')
    if (missing.length) {
      throw new Error(`Missing required configuration: ${missing.join(', ')}`)
    }
  }

  function ensureStorage() {
    if (!storage) {
      throw new Error('Missing required KV binding: nfd')
    }
  }

  async function kvGetJson(key) {
    ensureStorage()
    return storage.get(key, { type: 'json' })
  }

  async function kvPutJson(key, value) {
    ensureStorage()
    await storage.put(key, JSON.stringify(value))
  }

  async function kvListAll(prefix) {
    ensureStorage()
    const keys = []
    let cursor = undefined

    do {
      const page = await storage.list({ prefix, cursor, limit: 1000 })
      keys.push(...page.keys)
      cursor = page.list_complete ? undefined : page.cursor
    } while (cursor)

    return keys
  }

  function apiUrl(methodName, params = null) {
    let query = ''
    if (params) {
      query = '?' + new URLSearchParams(params).toString()
    }
    return `https://api.telegram.org/bot${token}/${methodName}${query}`
  }

  function makeReqBody(body) {
    return {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  }

  async function requestTelegram(methodName, body, params = null) {
    ensureConfigured()
    const response = await fetch(apiUrl(methodName, params), body)
    return response.json()
  }

  function sendMessage(msg = {}) {
    return requestTelegram('sendMessage', makeReqBody(msg))
  }

  function copyMessage(msg = {}) {
    return requestTelegram('copyMessage', makeReqBody(msg))
  }

  function forwardMessage(msg = {}) {
    return requestTelegram('forwardMessage', makeReqBody(msg))
  }

  function answerCallbackQuery(msg = {}) {
    return requestTelegram('answerCallbackQuery', makeReqBody(msg))
  }

  function editMessageText(msg = {}) {
    return requestTelegram('editMessageText', makeReqBody(msg))
  }

  function normalizeBaseUrl(requestOrigin = '') {
    if (publicBaseUrl) return publicBaseUrl
    return String(requestOrigin || '').trim().replace(/\/+$/, '')
  }

  function getRemoteIp(request) {
    return (
      request.headers.get('CF-Connecting-IP') ||
      request.headers.get('X-Forwarded-For') ||
      ''
    )
  }

  function pad2(value) {
    return String(value).padStart(2, '0')
  }

  function formatShiftedDate(date) {
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(
      date.getUTCDate()
    )}`
  }

  function getWeekBucket(dateLike = Date.now()) {
    const shifted = new Date(new Date(dateLike).getTime() + DEFAULTS.reportTimezoneOffsetMs)
    const start = new Date(
      Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
    )
    const dayOffset = (start.getUTCDay() + 6) % 7
    start.setUTCDate(start.getUTCDate() - dayOffset)
    const end = new Date(start)
    end.setUTCDate(start.getUTCDate() + 6)

    return {
      key: formatShiftedDate(start),
      startDate: formatShiftedDate(start),
      endDate: formatShiftedDate(end),
    }
  }

  function getPreviousWeekBucket(dateLike = Date.now()) {
    return getWeekBucket(new Date(dateLike).getTime() - 7 * 24 * 60 * 60 * 1000)
  }

  function getGuestDisplayName(chat = {}) {
    const fullName = [chat.first_name, chat.last_name].filter(Boolean).join(' ').trim()
    if (chat.username) return `${fullName || '未命名用户'} (@${chat.username})`
    return fullName || `UID:${chat.id}`
  }

  function getGuestShortName(chat = {}) {
    return [chat.first_name, chat.last_name].filter(Boolean).join(' ').trim() || chat.username || ''
  }

  function extractMessageContent(message = {}) {
    return (message.text || message.caption || '').trim()
  }

  function shortenText(text = '', limit = DEFAULTS.adminPreviewLimit) {
    const normalized = text.replace(/\s+/g, ' ').trim()
    if (normalized.length <= limit) return normalized
    return normalized.slice(0, Math.max(0, limit - 1)) + '...'
  }

  function formatDateTime(iso) {
    if (!iso) return '未知'
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return '未知'
    const shifted = new Date(date.getTime() + DEFAULTS.reportTimezoneOffsetMs)
    return `${formatShiftedDate(shifted)} ${pad2(shifted.getUTCHours())}:${pad2(
      shifted.getUTCMinutes()
    )}`
  }

  function getUsernameTag(profile = {}) {
    return profile.username ? `@${profile.username}` : '无用户名'
  }

  function buildProfileDisplayName(profile = {}) {
    const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim()
    if (profile.username) {
      return fullName ? `${fullName} (@${profile.username})` : `@${profile.username}`
    }
    return fullName || `UID:${profile.id || '未知'}`
  }

  function buildKeyboard(rows) {
    return {
      keyboard: rows,
      resize_keyboard: true,
    }
  }

  function buildInlineKeyboard(rows) {
    return {
      inline_keyboard: rows,
    }
  }

  function buildRemoveKeyboard() {
    return {
      remove_keyboard: true,
    }
  }

  function buildPermissionListKeyboard(page, totalPages) {
    const navRow = []
    if (page > 1) {
      navRow.push({
        text: ADMIN_UI.prevPage,
        callback_data: `${CALLBACK_PREFIX.permissionList}|${page - 1}`,
      })
    }
    if (page < totalPages) {
      navRow.push({
        text: ADMIN_UI.nextPage,
        callback_data: `${CALLBACK_PREFIX.permissionList}|${page + 1}`,
      })
    }

    const rows = []
    if (navRow.length) rows.push(navRow)
    rows.push([
      {
        text: ADMIN_UI.refresh,
        callback_data: `${CALLBACK_PREFIX.permissionList}|${page}`,
      },
      {
        text: ADMIN_UI.close,
        callback_data: `${CALLBACK_PREFIX.permissionList}|close`,
      },
    ])
    return buildInlineKeyboard(rows)
  }

  function buildPermissionEditKeyboard(chatId, page) {
    return buildInlineKeyboard([
      [
        {
          text: ADMIN_UI.setWhitelist,
          callback_data: `${CALLBACK_PREFIX.permissionEdit}|whitelist|${chatId}|${page}`,
        },
      ],
      [
        {
          text: ADMIN_UI.setBlacklist,
          callback_data: `${CALLBACK_PREFIX.permissionEdit}|blacklist|${chatId}|${page}`,
        },
      ],
      [
        {
          text: ADMIN_UI.setNormal,
          callback_data: `${CALLBACK_PREFIX.permissionEdit}|normal|${chatId}|${page}`,
        },
      ],
      [
        {
          text: ADMIN_UI.back,
          callback_data: `${CALLBACK_PREFIX.permissionEdit}|back|${chatId}|${page}`,
        },
        {
          text: ADMIN_UI.close,
          callback_data: `${CALLBACK_PREFIX.permissionEdit}|close|${chatId}|${page}`,
        },
      ],
    ])
  }

  function buildWelcomeMenuKeyboard() {
    return buildInlineKeyboard([
      [
        {
          text: '商务合作',
          callback_data: `${CALLBACK_PREFIX.welcome}|business`,
        },
      ],
      [
        {
          text: '解除封禁',
          callback_data: `${CALLBACK_PREFIX.welcome}|unban`,
        },
      ],
      [
        {
          text: '直接联系频道主',
          callback_data: `${CALLBACK_PREFIX.welcome}|usage`,
        },
      ],
    ])
  }

  function buildVerificationKeyboard(verificationUrl) {
    return {
      keyboard: [
        [
          {
            text: '打开验证网页',
            web_app: {
              url: verificationUrl,
            },
          },
        ],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    }
  }

  function buildBanRulesKeyboard(rules, page, totalPages) {
    const rows = rules.map((rule, index) => [
      {
        text: `🗑 删除 ${index + 1}`,
        callback_data: `${CALLBACK_PREFIX.banRules}|delete|${rule.id}|${page}`,
      },
    ])

    const navRow = []
    if (page > 1) {
      navRow.push({
        text: ADMIN_UI.prevPage,
        callback_data: `${CALLBACK_PREFIX.banRules}|page|${page - 1}`,
      })
    }
    if (page < totalPages) {
      navRow.push({
        text: ADMIN_UI.nextPage,
        callback_data: `${CALLBACK_PREFIX.banRules}|page|${page + 1}`,
      })
    }
    if (navRow.length) rows.push(navRow)

    rows.push([
      {
        text: ADMIN_UI.refresh,
        callback_data: `${CALLBACK_PREFIX.banRules}|page|${page}`,
      },
      {
        text: ADMIN_UI.close,
        callback_data: `${CALLBACK_PREFIX.banRules}|close|${page}`,
      },
    ])

    return buildInlineKeyboard(rows)
  }

  function getEmptyWeekStats(bucket) {
    return {
      key: bucket.key,
      startDate: bucket.startDate,
      endDate: bucket.endDate,
      total: 0,
      auto: 0,
      manual: 0,
      users: [],
      sentAt: null,
    }
  }

  function getAdminHelpText() {
    return [
      '管理员使用方法：',
      '1. 引用一条用户消息后直接回复，可把消息转发回用户',
      '2. 引用用户消息后可用 /block、/unblock、/checkblock',
      '3. 重置用户验证状态：/resetverify（引用用户消息）或 /resetverify 用户UID',
      '4. 关键词黑名单命令：',
      '/banrule_add 关键词 || 命中后回复语',
      '/banrule_list 查看当前黑名单规则列表，并可通过消息下方按钮删除规则',
      '/banreport_now 立即查看本周实时封禁统计',
      `${ADMIN_UI.command} 查看封禁用户权限列表`,
    ].join('\n')
  }

  function formatRuleMatcher(rule) {
    if (rule.mode === 'regex') {
      return `/${rule.pattern}/${rule.flags || ''}`
    }
    return rule.pattern
  }

  function formatRuleSummary(rule) {
    return `[${rule.id}] ${rule.mode} ${formatRuleMatcher(rule)}`
  }

  async function getBanRules() {
    const rules = await kvGetJson(DEFAULTS.banRulesKey)
    return Array.isArray(rules) ? rules : []
  }

  async function saveBanRules(rules) {
    await kvPutJson(DEFAULTS.banRulesKey, rules)
  }

  async function getBanStats() {
    const stats = await kvGetJson(DEFAULTS.banStatsKey)
    if (stats && typeof stats === 'object' && !Array.isArray(stats)) {
      if (!stats.weeks || typeof stats.weeks !== 'object') {
        stats.weeks = {}
      }
      return stats
    }
    return { weeks: {} }
  }

  async function saveBanStats(stats) {
    await kvPutJson(DEFAULTS.banStatsKey, stats)
  }

  async function getWeekStats(bucket) {
    const stats = await getBanStats()
    const weekStats = stats.weeks[bucket.key] || getEmptyWeekStats(bucket)
    if (!Array.isArray(weekStats.users)) {
      weekStats.users = []
    }
    return { stats, weekStats }
  }

  async function saveUserProfile(chat = {}) {
    if (!chat.id) return null

    const key = `user-profile-${chat.id}`
    const now = Date.now()
    const nextProfile = {
      id: String(chat.id),
      username: chat.username || '',
      firstName: chat.first_name || '',
      lastName: chat.last_name || '',
      updatedAt: new Date(now).toISOString(),
      updatedAtMs: now,
    }
    const existing = await kvGetJson(key)

    if (
      existing &&
      existing.username === nextProfile.username &&
      existing.firstName === nextProfile.firstName &&
      existing.lastName === nextProfile.lastName &&
      now - Number(existing.updatedAtMs || 0) < 12 * 60 * 60 * 1000
    ) {
      return existing
    }

    await kvPutJson(key, nextProfile)
    return nextProfile
  }

  async function getUserProfile(chatId) {
    const profile = await kvGetJson(`user-profile-${chatId}`)
    if (profile) return profile
    return {
      id: String(chatId),
      username: '',
      firstName: '',
      lastName: '',
    }
  }

  async function hasShownWelcomeMenu(chatId) {
    return Boolean(await kvGetJson(`welcome-shown-${chatId}`))
  }

  async function markWelcomeMenuShown(chatId) {
    await kvPutJson(`welcome-shown-${chatId}`, true)
  }

  async function hasCompletedWelcomeSelection(chatId) {
    const state = await kvGetJson(`welcome-selection-${chatId}`)
    return Boolean(state?.completed)
  }

  async function markWelcomeSelection(chatId, action) {
    await kvPutJson(`welcome-selection-${chatId}`, {
      completed: true,
      action,
      selectedAt: new Date().toISOString(),
    })
  }

  function getVerificationSessionKey(sessionId) {
    return `verify-session-${sessionId}`
  }

  function getActiveVerificationSessionKey(chatId) {
    return `verify-session-active-${chatId}`
  }

  function getVerificationResetAtKey(chatId) {
    return `verify-reset-at-${chatId}`
  }

  function isVerificationSessionExpired(session = {}, referenceTime = Date.now()) {
    return !session.expiresAt || new Date(session.expiresAt).getTime() <= referenceTime
  }

  async function isVerificationSessionStale(session, referenceTime = Date.now()) {
    if (!session) return true
    if (isVerificationSessionExpired(session, referenceTime)) return true

    const resetAt = await kvGetJson(getVerificationResetAtKey(session.chatId))
    if (!resetAt) return false

    const sessionCreatedAt = new Date(session.createdAt || 0).getTime()
    const resetAtMs = new Date(resetAt).getTime()
    if (!Number.isFinite(sessionCreatedAt) || !Number.isFinite(resetAtMs)) {
      return true
    }

    return resetAtMs >= sessionCreatedAt
  }

  async function getVerificationSession(sessionId) {
    if (!sessionId) return null
    return kvGetJson(getVerificationSessionKey(sessionId))
  }

  async function createVerificationSession(chatId) {
    const now = Date.now()
    const sessionId = crypto.randomUUID()
    const session = {
      sessionId,
      chatId: String(chatId),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + DEFAULTS.verificationSessionTtlMs).toISOString(),
      completedAt: null,
    }
    await kvPutJson(getVerificationSessionKey(sessionId), session)
    await kvPutJson(getActiveVerificationSessionKey(chatId), {
      sessionId,
      expiresAt: session.expiresAt,
    })
    return session
  }

  async function getOrCreateVerificationSession(chatId, forceNew = false) {
    if (!forceNew) {
      const active = await kvGetJson(getActiveVerificationSessionKey(chatId))
      const activeSessionId = active?.sessionId
      if (activeSessionId) {
        const session = await getVerificationSession(activeSessionId)
        if (session && !session.completedAt && !(await isVerificationSessionStale(session))) {
          return session
        }
      }
    }
    return createVerificationSession(chatId)
  }

  async function consumeVerificationSession(sessionId, updates = {}) {
    const session = await getVerificationSession(sessionId)
    if (!session) return null
    const nextSession = {
      ...session,
      ...updates,
    }
    await kvPutJson(getVerificationSessionKey(sessionId), nextSession)
    if (nextSession.completedAt || isVerificationSessionExpired(nextSession)) {
      await kvPutJson(getActiveVerificationSessionKey(nextSession.chatId), null)
    }
    return nextSession
  }

  async function resetVerificationState(chatId) {
    const nowIso = new Date().toISOString()
    await Promise.all([
      kvPutJson(`verified-${chatId}`, false),
      kvPutJson(`captcha-answer-${chatId}`, null),
      kvPutJson(`captcha-attempts-${chatId}`, null),
      kvPutJson(`welcome-shown-${chatId}`, false),
      kvPutJson(`welcome-selection-${chatId}`, null),
      kvPutJson(getActiveVerificationSessionKey(chatId), null),
      kvPutJson(getVerificationResetAtKey(chatId), nowIso),
    ])
    return nowIso
  }

  function toBase64UrlFromBytes(bytes) {
    let binary = ''
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  }

  function toBase64UrlFromText(text) {
    return toBase64UrlFromBytes(new TextEncoder().encode(text))
  }

  function fromBase64Url(value) {
    const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
    return atob(padded)
  }

  function fromBase64UrlToText(value) {
    const binary = fromBase64Url(value)
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  }

  async function getGrantSigningKey() {
    return crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    )
  }

  async function signVerificationGrant(payload) {
    const serialized = JSON.stringify(payload)
    const key = await getGrantSigningKey()
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(serialized)
    )
    return `${toBase64UrlFromText(serialized)}.${toBase64UrlFromBytes(new Uint8Array(signature))}`
  }

  async function verifyVerificationGrant(tokenValue, expectedChatId) {
    const [payloadPart, signaturePart] = String(tokenValue || '').split('.')
    if (!payloadPart || !signaturePart) return null

    let serialized = ''
    let signatureBytes = null
    try {
      serialized = fromBase64UrlToText(payloadPart)
      signatureBytes = Uint8Array.from(fromBase64Url(signaturePart), char => char.charCodeAt(0))
    } catch {
      return null
    }

    const key = await getGrantSigningKey()
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      new TextEncoder().encode(serialized)
    )
    if (!valid) return null

    let payload = null
    try {
      payload = JSON.parse(serialized)
    } catch {
      return null
    }

    if (!payload || String(payload.chatId || '') !== String(expectedChatId)) {
      return null
    }

    const expiresAtMs = Number(payload.expiresAtMs || 0)
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      return null
    }

    const resetAt = await kvGetJson(getVerificationResetAtKey(expectedChatId))
    if (resetAt) {
      const resetAtMs = new Date(resetAt).getTime()
      if (Number.isFinite(resetAtMs) && resetAtMs >= Number(payload.issuedAtMs || 0)) {
        return null
      }
    }

    return payload
  }

  async function getWhitelistState(chatId) {
    const whitelisted = await kvGetJson(`iswhitelisted-${chatId}`)
    if (!whitelisted) return { whitelisted: false, whitelistInfo: null }
    const whitelistInfo = await kvGetJson(`whitelist-info-${chatId}`)
    return { whitelisted: true, whitelistInfo }
  }

  async function setWhitelistState(chatId, whitelistInfo = {}) {
    const mergedInfo = {
      source: 'manual',
      addedAt: new Date().toISOString(),
      ...whitelistInfo,
    }
    await kvPutJson(`iswhitelisted-${chatId}`, true)
    await kvPutJson(`whitelist-info-${chatId}`, mergedInfo)
    await clearBlockedState(chatId)
    return mergedInfo
  }

  async function clearWhitelistState(chatId) {
    await kvPutJson(`iswhitelisted-${chatId}`, false)
    await kvPutJson(`whitelist-info-${chatId}`, null)
  }

  async function getAdminUiState() {
    return kvGetJson(ADMIN_UI.stateKey)
  }

  async function saveAdminUiState(state) {
    await kvPutJson(ADMIN_UI.stateKey, state)
  }

  async function clearAdminUiState() {
    await kvPutJson(ADMIN_UI.stateKey, null)
  }

  function trimBanStats(stats) {
    const weekKeys = Object.keys(stats.weeks || {}).sort()
    if (weekKeys.length <= DEFAULTS.maxBanStatsWeeks) return
    for (const key of weekKeys.slice(0, weekKeys.length - DEFAULTS.maxBanStatsWeeks)) {
      delete stats.weeks[key]
    }
  }

  async function recordBanEvent(chatId, blockInfo) {
    const stats = await getBanStats()
    const bucket = getWeekBucket(blockInfo.blockedAt || Date.now())
    const weeks = stats.weeks || {}
    const weekStats = weeks[bucket.key] || getEmptyWeekStats(bucket)

    if (!Array.isArray(weekStats.users)) {
      weekStats.users = []
    }

    const userId = String(chatId)
    if (!weekStats.users.includes(userId)) {
      weekStats.users.push(userId)
      weekStats.total += 1
      if (blockInfo.source === 'keyword') {
        weekStats.auto += 1
      } else {
        weekStats.manual += 1
      }
    }

    weeks[bucket.key] = weekStats
    stats.weeks = weeks
    trimBanStats(stats)
    await saveBanStats(stats)
  }

  async function setBlockedState(chatId, blockInfo = {}) {
    const blockKey = `isblocked-${chatId}`
    const infoKey = `block-info-${chatId}`
    const alreadyBlocked = await kvGetJson(blockKey)
    if (alreadyBlocked) {
      return { alreadyBlocked: true, blockInfo: await kvGetJson(infoKey) }
    }

    const mergedInfo = {
      source: 'manual',
      blockedAt: new Date().toISOString(),
      blockMessage: DEFAULTS.manualBlockMessage,
      notifiedAt: null,
      ...blockInfo,
    }

    await clearWhitelistState(chatId)
    await kvPutJson(blockKey, true)
    await kvPutJson(infoKey, mergedInfo)
    await recordBanEvent(chatId, mergedInfo)
    return { alreadyBlocked: false, blockInfo: mergedInfo }
  }

  async function clearBlockedState(chatId) {
    await kvPutJson(`isblocked-${chatId}`, false)
    await kvPutJson(`block-info-${chatId}`, null)
  }

  async function markBlockedUserNotified(chatId) {
    const infoKey = `block-info-${chatId}`
    const blockInfo =
      (await kvGetJson(infoKey)) || {
        source: 'legacy',
        blockedAt: null,
        blockMessage: DEFAULTS.defaultBlockMessage,
        notifiedAt: null,
      }
    if (blockInfo.notifiedAt) return blockInfo
    const nextInfo = {
      ...blockInfo,
      notifiedAt: new Date().toISOString(),
    }
    await kvPutJson(infoKey, nextInfo)
    return nextInfo
  }

  async function getBlockedState(chatId) {
    const blocked = await kvGetJson(`isblocked-${chatId}`)
    if (!blocked) return { blocked: false, blockInfo: null }
    const blockInfo =
      (await kvGetJson(`block-info-${chatId}`)) || {
        source: 'legacy',
        blockedAt: null,
        blockMessage: DEFAULTS.defaultBlockMessage,
        notifiedAt: null,
      }
    return { blocked: true, blockInfo }
  }

  async function getUserPermissionStatus(chatId) {
    const whitelistState = await getWhitelistState(chatId)
    if (whitelistState.whitelisted) {
      return { status: 'whitelist', label: '白名单', detail: whitelistState.whitelistInfo }
    }

    const blockedState = await getBlockedState(chatId)
    if (blockedState.blocked) {
      return { status: 'blacklist', label: '黑名单', detail: blockedState.blockInfo }
    }

    return { status: 'normal', label: '普通用户', detail: null }
  }

  function parseRulePayload(text, command) {
    const raw = text.slice(command.length).trim()
    if (!raw) return null

    const pieces = raw.split('||')
    const pattern = (pieces.shift() || '').trim()
    const reply = pieces.join('||').trim()
    if (!pattern) return null

    return {
      pattern,
      reply: reply || DEFAULTS.defaultBlockMessage,
    }
  }

  function parseBanRuleAddCommand(text) {
    const raw = text.replace(/^\/banrule_add\b/, '').trim()
    if (!raw) return null

    const pieces = raw.split('||')
    const pattern = (pieces.shift() || '').trim()
    const reply = pieces.join('||').trim()
    if (!pattern) return null

    return {
      mode: 'contains',
      pattern,
      reply: reply || DEFAULTS.defaultBlockMessage,
    }
  }

  function matchBanRule(rule, text) {
    const content = (text || '').trim()
    if (!content || !rule || !rule.pattern) return false
    const pattern = rule.pattern.trim()

    if (rule.mode === 'exact') {
      return content === pattern
    }

    if (rule.mode === 'regex') {
      try {
        return new RegExp(pattern, rule.flags || 'i').test(content)
      } catch (error) {
        console.log('invalid ban rule regex', rule.id, String(error))
        return false
      }
    }

    return content.toLowerCase().includes(pattern.toLowerCase())
  }

  async function findTriggeredBanRule(message) {
    const content = extractMessageContent(message)
    if (!content) return null

    const rules = await getBanRules()
    for (const rule of rules) {
      if (matchBanRule(rule, content)) {
        return { rule, content }
      }
    }
    return null
  }

  function buildWeeklySummaryText(weekStats, title = '封禁周报') {
    return [
      title,
      `统计周期：${weekStats.startDate} ~ ${weekStats.endDate} (${DEFAULTS.reportTimezoneLabel})`,
      `总封禁人数：${weekStats.total || 0}`,
      `关键词自动封禁：${weekStats.auto || 0}`,
      `管理员手动封禁：${weekStats.manual || 0}`,
    ].join('\n')
  }

  function buildCurrentBanSummaryText(activeStats, weekStats) {
    return [
      '封禁统计（实时）',
      `当前仍在封禁：${activeStats.total || 0}`,
      `当前自动封禁：${activeStats.auto || 0}`,
      `当前手动封禁：${activeStats.manual || 0}`,
      '',
      `本周新增封禁：${weekStats.total || 0}`,
      `本周新增自动封禁：${weekStats.auto || 0}`,
      `本周新增手动封禁：${weekStats.manual || 0}`,
    ].join('\n')
  }

  function buildBanRulesListText(rules, page, totalPages, totalRules) {
    const lines = rules.map((rule, index) => {
      return [
        `${index + 1}. ${formatRuleSummary(rule)}`,
        `回复：${rule.reply}`,
      ].join('\n')
    })

    return [
      `黑名单规则列表（第 ${page}/${totalPages} 页）`,
      `总规则数：${totalRules}`,
      '',
      ...lines,
      '',
      '点击对应删除按钮即可移除规则。',
    ].join('\n')
  }

  async function listBlockedUsers() {
    const blockedKeys = await kvListAll('isblocked-')
    const blockedUsers = []

    for (const keyInfo of blockedKeys) {
      const chatId = keyInfo.name.replace('isblocked-', '')
      if (!chatId) continue

      const blocked = await kvGetJson(keyInfo.name)
      if (!blocked) continue

      const [blockInfo, profile] = await Promise.all([
        kvGetJson(`block-info-${chatId}`),
        getUserProfile(chatId),
      ])

      blockedUsers.push({
        chatId: String(chatId),
        blockInfo: blockInfo || {},
        profile,
      })
    }

    blockedUsers.sort((left, right) => {
      return new Date(right.blockInfo?.blockedAt || 0).getTime() -
        new Date(left.blockInfo?.blockedAt || 0).getTime()
    })

    return blockedUsers
  }

  async function getActiveBlockedSummary() {
    const blockedUsers = await listBlockedUsers()
    const summary = {
      total: blockedUsers.length,
      auto: 0,
      manual: 0,
    }

    for (const user of blockedUsers) {
      if (user.blockInfo?.source === 'keyword') {
        summary.auto += 1
      } else {
        summary.manual += 1
      }
    }

    return summary
  }

  function buildBlockedUsersListText(users, page, totalPages, totalUsers) {
    const lines = users.map((user, index) => {
      return [
        `${index + 1}. ${buildProfileDisplayName(user.profile)}`,
        `UID: ${user.chatId}`,
        `封禁时间: ${formatDateTime(user.blockInfo?.blockedAt)}`,
      ].join('\n')
    })

    return [
      `黑名单用户列表（第 ${page}/${totalPages} 页）`,
      `总人数：${totalUsers}`,
      '',
      ...lines,
      '',
      '回复当前页中的序号，可进入权限编辑面板。',
    ].join('\n')
  }

  function buildPermissionEditorText(profile, permissionStatus, chatId) {
    return [
      '编辑用户权限',
      '',
      `用户：${buildProfileDisplayName(profile)}`,
      `UID：${chatId}`,
      `当前状态：${permissionStatus.label}`,
      '',
      '权限说明：',
      '• 好友/白名单：消息不过滤，直接转发',
      '• 黑名单：禁止对话，消息被拦截',
      '• 普通用户：受过滤规则影响',
    ].join('\n')
  }

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
  }

  async function buildVerificationUrl(chatId, requestOrigin, forceNew = false) {
    const baseUrl = normalizeBaseUrl(requestOrigin)
    if (!baseUrl) {
      throw new Error('Missing PUBLIC_BASE_URL or request origin for verification links')
    }
    const session = await getOrCreateVerificationSession(chatId, forceNew)
    return `${baseUrl}${verificationPagePath}?session=${encodeURIComponent(session.sessionId)}`
  }

  function renderVerificationPage({
    sessionId,
    status = 'pending',
    title = 'Cloudflare 人机验证',
    description = '请完成验证后返回 Telegram 继续发送消息。',
    siteKey = '',
    submitPath = '',
    canRenderWidget = false,
  }) {
    const safeTitle = escapeHtml(title)
    const safeDescription = escapeHtml(description)
    const safeSessionId = escapeHtml(sessionId || '')
    const safeSiteKey = escapeHtml(siteKey || '')
    const safeSubmitPath = escapeHtml(submitPath || '')
    const safeStatus = escapeHtml(status)

    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f1e7;
        --card: #fffdf8;
        --ink: #1f2937;
        --subtle: #6b7280;
        --line: #ddd3c2;
        --accent: #146356;
        --danger: #b42318;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background:
          radial-gradient(circle at top left, rgba(20, 99, 86, 0.14), transparent 32%),
          radial-gradient(circle at bottom right, rgba(182, 142, 84, 0.16), transparent 24%),
          var(--bg);
        color: var(--ink);
        font: 16px/1.6 "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif;
      }
      main {
        width: min(520px, 100%);
        padding: 28px;
        border: 1px solid var(--line);
        border-radius: 24px;
        background: var(--card);
        box-shadow: 0 20px 56px rgba(31, 41, 55, 0.1);
      }
      h1 {
        margin: 0 0 10px;
        font-size: clamp(26px, 4vw, 34px);
        line-height: 1.15;
      }
      p {
        margin: 0 0 14px;
        color: var(--subtle);
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 14px;
        padding: 6px 12px;
        border-radius: 999px;
        background: rgba(20, 99, 86, 0.08);
        color: var(--accent);
        font-size: 13px;
        font-weight: 600;
      }
      .panel {
        margin-top: 20px;
        padding: 16px;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: rgba(20, 99, 86, 0.03);
      }
      .panel.success-panel {
        background: rgba(20, 99, 86, 0.08);
      }
      .hidden {
        display: none !important;
      }
      .success-title {
        margin-top: 4px;
        font-size: clamp(30px, 5vw, 40px);
        line-height: 1.08;
        font-weight: 700;
        color: var(--accent);
      }
      .success-subtitle {
        margin-top: 10px;
        white-space: pre-line;
        font-size: 16px;
        color: var(--ink);
      }
      .hint {
        margin-top: 10px;
        font-size: 14px;
        color: var(--subtle);
      }
      .status {
        min-height: 24px;
        margin-top: 16px;
        color: var(--subtle);
      }
      .status.error { color: var(--danger); }
      .status.success { color: var(--accent); }
      .actions {
        margin-top: 18px;
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }
      button {
        border: 0;
        border-radius: 999px;
        padding: 12px 18px;
        background: var(--accent);
        color: #fff;
        font: inherit;
        cursor: pointer;
      }
      button.secondary {
        background: #e8e1d5;
        color: var(--ink);
      }
      button:disabled {
        cursor: wait;
        opacity: 0.7;
      }
    </style>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    ${canRenderWidget ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}
  </head>
  <body>
    <main>
      <div class="badge">Cloudflare Turnstile</div>
      <h1>${safeTitle}</h1>
      <p>${safeDescription}</p>
      <div id="panel" class="panel">
        ${
          canRenderWidget
            ? `<div id="challengeArea">
                <div
                  class="cf-turnstile"
                  data-sitekey="${safeSiteKey}"
                  data-callback="onTurnstileSuccess"
                  data-error-callback="onTurnstileError"
                  data-expired-callback="onTurnstileExpired"
                  data-refresh-expired="auto"
              ></div>
                <div class="hint">由于网络原因可能验证时间较长，请耐心等待验证结果。请务必点击按钮返回对话，否则无效。</div>
              </div>
              <div id="successArea" class="hidden">
                <div class="success-title">验证已经完成</div>
                <div class="success-subtitle">请务必点击按钮返回对话。</div>
              </div>`
            : '<div class="status">当前无需再次验证。</div>'
        }
        <div id="status" class="status" data-state="${safeStatus}"></div>
        <div class="actions">
          ${
            canRenderWidget
              ? '<button id="retry" class="secondary" type="button" onclick="retryTurnstile()">重新加载验证</button><button id="closeBtn" class="hidden" type="button" onclick="finalizeVerification()">返回对话</button>'
              : '<button type="button" onclick="closePage()">关闭页面</button>'
          }
        </div>
      </div>
    </main>
    <script>
      const SESSION_ID = ${JSON.stringify(sessionId || '')};
      const SUBMIT_PATH = ${JSON.stringify(submitPath || '')};
      const statusEl = document.getElementById('status');
      const retryBtn = document.getElementById('retry');
      const closeBtn = document.getElementById('closeBtn');
      const challengeArea = document.getElementById('challengeArea');
      const successArea = document.getElementById('successArea');
      const panelEl = document.getElementById('panel');
      const tgWebApp =
        window.Telegram &&
        window.Telegram.WebApp &&
        typeof window.Telegram.WebApp.sendData === 'function'
          ? window.Telegram.WebApp
          : null;
      let pendingHandoffPayload = '';
      let handoffDispatched = false;

      if (tgWebApp) {
        try {
          tgWebApp.ready();
          if (typeof tgWebApp.expand === 'function') tgWebApp.expand();
          if (typeof tgWebApp.enableClosingConfirmation === 'function') {
            tgWebApp.enableClosingConfirmation();
          }
        } catch (error) {}
      }

      function setStatus(message, kind) {
        if (!statusEl) return;
        statusEl.textContent = message || '';
        statusEl.className = kind ? 'status ' + kind : 'status';
      }

      function showSuccessState(message) {
        if (challengeArea) challengeArea.classList.add('hidden');
        if (successArea) successArea.classList.remove('hidden');
        if (retryBtn) retryBtn.classList.add('hidden');
        if (closeBtn) {
          closeBtn.classList.remove('hidden');
          closeBtn.disabled = false;
          closeBtn.focus();
        }
        if (panelEl) panelEl.classList.add('success-panel');
        setStatus(message || '验证已经完成，请点击按钮返回对话。', 'success');
      }

      function dispatchHandoff() {
        if (!pendingHandoffPayload || !tgWebApp || handoffDispatched) return false;
        handoffDispatched = true;
        try {
          tgWebApp.sendData(pendingHandoffPayload);
          return true;
        } catch (error) {
          handoffDispatched = false;
          return false;
        }
      }

      async function submitToken(token) {
        if (!token) {
          setStatus('验证票据为空，请重试。', 'error');
          return;
        }

        if (retryBtn) retryBtn.disabled = true;
        setStatus('正在校验，请稍候...', '');

        try {
          const response = await fetch(SUBMIT_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              session: SESSION_ID,
              token,
              transport: tgWebApp ? 'webapp' : 'direct',
            }),
          });

          const result = await response.json();
          if (!response.ok || !result.ok) {
            setStatus(result.message || '验证失败，请重试。', 'error');
            if (retryBtn) retryBtn.disabled = false;
            return;
          }

          pendingHandoffPayload = result.handoffPayload || '';
          showSuccessState(
            result.message ||
              (pendingHandoffPayload
                ? '验证已经完成，请点击按钮返回对话。'
                : '验证已经完成，现在可以关闭页面并返回 Telegram。')
          );
        } catch (error) {
          setStatus('网络错误，请稍后再试。', 'error');
          if (retryBtn) retryBtn.disabled = false;
        }
      }

      function retryTurnstile() {
        if (window.turnstile) {
          window.turnstile.reset();
        }
        if (retryBtn) retryBtn.disabled = false;
        setStatus('请重新完成验证。', '');
      }

      function closePage() {
        if (tgWebApp) {
          dispatchHandoff();
          tgWebApp.close();
          return;
        }
        window.close();
        setTimeout(function () {
          try {
            window.history.back();
          } catch (error) {}
        }, 80);
      }

      function finalizeVerification() {
        if (pendingHandoffPayload && tgWebApp) {
          if (dispatchHandoff()) {
            return;
          }
          setStatus('返回 Telegram 失败，请再试一次。', 'error');
          return;
        }
        closePage();
      }

      window.onTurnstileSuccess = submitToken;
      window.onTurnstileError = function () {
        setStatus('验证组件加载失败，请稍后重试。', 'error');
        if (retryBtn) retryBtn.disabled = false;
      };
      window.onTurnstileExpired = function () {
        setStatus('验证已过期，请重新完成一次。', 'error');
        if (retryBtn) retryBtn.disabled = false;
      };

      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') {
          dispatchHandoff();
        }
      });

      window.addEventListener('pagehide', function () {
        dispatchHandoff();
      });

      window.addEventListener('beforeunload', function () {
        dispatchHandoff();
      });

      if (statusEl && statusEl.dataset.state === 'success') {
        showSuccessState('当前会话已经验证成功，请关闭页面后返回 Telegram。');
      } else if (statusEl && statusEl.dataset.state === 'expired') {
        setStatus('这个验证链接已经过期，请回到 Telegram 重新获取。', 'error');
      } else if (statusEl && statusEl.dataset.state === 'missing') {
        setStatus('验证链接无效，请回到 Telegram 重新获取。', 'error');
      }
    </script>
  </body>
</html>`
  }

  function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }

  function genCaptcha() {
    const operators = ['+', '-', '*', '/']
    const op = operators[randInt(0, operators.length - 1)]

    if (op === '+') {
      const a = randInt(0, 100)
      const b = randInt(0, 100 - a)
      return { question: `${a} + ${b} = ?`, answer: a + b }
    }

    if (op === '-') {
      const a = randInt(0, 100)
      const b = randInt(0, a)
      return { question: `${a} - ${b} = ?`, answer: a - b }
    }

    if (op === '*') {
      const a = randInt(0, 10)
      const maxB = a === 0 ? 10 : Math.floor(100 / a)
      const b = randInt(0, maxB)
      return { question: `${a} × ${b} = ?`, answer: a * b }
    }

    const divisor = randInt(1, 10)
    const quotient = randInt(0, Math.floor(100 / divisor))
    const dividend = divisor * quotient
    return { question: `${dividend} ÷ ${divisor} = ?`, answer: quotient }
  }

  async function sendCaptcha(chatId, forceNew = false, requestOrigin = '') {
    if (hasTurnstileConfig) {
      const verificationUrl = await buildVerificationUrl(chatId, requestOrigin, forceNew)
      return sendMessage({
        chat_id: chatId,
        text:
          '为了继续私聊，请先完成 Cloudflare 人机验证。\n\n点击下方按钮打开验证网页。由于网络原因可能验证时间较长，请耐心等待验证结果。请务必在页面显示“验证已经完成”后点击按钮返回对话，否则可能不会立即生效。',
        reply_markup: buildVerificationKeyboard(verificationUrl),
      })
    }

    const ansKey = `captcha-answer-${chatId}`
    const attKey = `captcha-attempts-${chatId}`
    const answerObj = await kvGetJson(ansKey)
    const attempts = await kvGetJson(attKey)

    if (forceNew || !answerObj || !answerObj.question) {
      const { question, answer } = genCaptcha()
      await kvPutJson(ansKey, { question, answer })
      await kvPutJson(attKey, { left: captchaMaxAttempts })
      return sendMessage({
        chat_id: chatId,
        text: `为了防止机器人滥用，请先通过 100 以内四则运算验证：\n\n${question}\n\n请直接回复数字答案（例如：8）。`,
      })
    }

    if (!attempts || typeof attempts.left !== 'number') {
      await kvPutJson(attKey, { left: captchaMaxAttempts })
    }

    return sendMessage({
      chat_id: chatId,
      text: `请先完成当前算术验证再继续对话：\n\n${answerObj.question}\n\n（直接回复答案即可；如需更换题目可发送 /captcha）`,
    })
  }

  async function checkCaptchaAndMaybeVerify(message, requestOrigin = '') {
    const chatId = message.chat.id
    const text = (message.text || '').trim()

    if (hasTurnstileConfig) {
      await sendCaptcha(chatId, /^\/captcha$/.test(text), requestOrigin)
      return { verified: false }
    }

    if (/^\/captcha$/.test(text)) {
      await sendCaptcha(chatId, true, requestOrigin)
      return { verified: false }
    }

    const ansKey = `captcha-answer-${chatId}`
    const attKey = `captcha-attempts-${chatId}`
    const answerObj = await kvGetJson(ansKey)
    const attempts = await kvGetJson(attKey)

    if (!answerObj) {
      await sendCaptcha(chatId, true, requestOrigin)
      return { verified: false }
    }

    const numeric = Number(text)
    if (!Number.isFinite(numeric)) {
      await sendMessage({
        chat_id: chatId,
        text: '请直接回复一个数字作为答案（例如：8）。如需更换题目可发送 /captcha',
      })
      return { verified: false }
    }

    const left =
      attempts && typeof attempts.left === 'number' ? attempts.left : captchaMaxAttempts

    if (numeric === answerObj.answer) {
      await kvPutJson(`verified-${chatId}`, true)
      await kvPutJson(ansKey, null)
      await kvPutJson(attKey, null)
      await sendMessage({
        chat_id: chatId,
        text: '✅ 验证通过！现在您可以正常对话啦。',
      })
      if (!(await hasShownWelcomeMenu(chatId))) {
        await sendWelcomeMenu(chatId)
      }
      return { verified: true, justVerified: true }
    }

    const remain = Math.max(0, left - 1)
    await kvPutJson(attKey, { left: remain })
    if (remain <= 0) {
      await kvPutJson(ansKey, null)
      await kvPutJson(attKey, null)
      await sendMessage({
        chat_id: chatId,
        text: '❌ 回答错误，已无剩余机会。我已为你生成新题，请再试一次。',
      })
      await sendCaptcha(chatId, true, requestOrigin)
    } else {
      await sendMessage({
        chat_id: chatId,
        text: `❌ 回答错误，还剩 ${remain} 次机会。请再试一次，或发送 /captcha 更换题目。`,
      })
    }
    return { verified: false }
  }

  async function fetchText(url, fallback = '') {
    try {
      const response = await fetch(url)
      if (!response.ok) return fallback
      return response.text()
    } catch {
      return fallback
    }
  }

  async function sendWelcomeMenu(chatId) {
    await markWelcomeMenuShown(chatId)
    return sendMessage({
      chat_id: chatId,
      text: WELCOME_MENU_TEXT,
      reply_markup: buildWelcomeMenuKeyboard(),
    })
  }

  async function maybePromptCaptcha(chatId, requestOrigin = '') {
    if (!captchaEnabled) return null
    const whitelistState = await getWhitelistState(chatId)
    if (whitelistState.whitelisted) return null
    const verified = await kvGetJson(`verified-${chatId}`)
    if (verified) return null
    if (!(await hasCompletedWelcomeSelection(chatId))) return null
    return sendCaptcha(chatId, false, requestOrigin)
  }

  async function safeEditMessageText(msg = {}) {
    const result = await editMessageText(msg)
    if (
      result &&
      result.ok === false &&
      typeof result.description === 'string' &&
      result.description.includes('message is not modified')
    ) {
      return { ok: true, result: null }
    }
    return result
  }

  async function renderBanRulesPage({ page = 1, chatId, messageId = null }) {
    const rules = await getBanRules()
    if (!rules.length) {
      if (messageId) {
        return safeEditMessageText({
          chat_id: chatId,
          message_id: messageId,
          text: '当前没有黑名单关键词规则。',
        })
      }
      return sendMessage({
        chat_id: chatId,
        text: '当前没有黑名单关键词规则。',
      })
    }

    const totalPages = Math.max(1, Math.ceil(rules.length / BAN_RULES_UI.pageSize))
    const safePage = Math.min(Math.max(1, page), totalPages)
    const startIndex = (safePage - 1) * BAN_RULES_UI.pageSize
    const pageRules = rules.slice(startIndex, startIndex + BAN_RULES_UI.pageSize)

    const payload = {
      chat_id: chatId,
      text: buildBanRulesListText(pageRules, safePage, totalPages, rules.length),
      reply_markup: buildBanRulesKeyboard(pageRules, safePage, totalPages),
    }

    if (messageId) {
      return safeEditMessageText({
        ...payload,
        message_id: messageId,
      })
    }

    return sendMessage(payload)
  }

  async function showBlockedUsersPage(page = 1) {
    return renderBlockedUsersPage({
      page,
      chatId: adminUid,
      messageId: null,
    })
  }

  async function renderBlockedUsersPage({ page = 1, chatId, messageId = null }) {
    const blockedUsers = await listBlockedUsers()
    if (!blockedUsers.length) {
      await clearAdminUiState()
      if (messageId) {
        return safeEditMessageText({
          chat_id: chatId,
          message_id: messageId,
          text: '当前没有黑名单用户。',
        })
      }
      return sendMessage({
        chat_id: chatId,
        text: '当前没有黑名单用户。',
      })
    }

    const totalPages = Math.max(1, Math.ceil(blockedUsers.length / ADMIN_UI.pageSize))
    const safePage = Math.min(Math.max(1, page), totalPages)
    const startIndex = (safePage - 1) * ADMIN_UI.pageSize
    const pageUsers = blockedUsers.slice(startIndex, startIndex + ADMIN_UI.pageSize)

    await saveAdminUiState({
      mode: 'permission-list',
      page: safePage,
      visibleUserIds: pageUsers.map(user => user.chatId),
    })

    const payload = {
      chat_id: chatId,
      text: buildBlockedUsersListText(pageUsers, safePage, totalPages, blockedUsers.length),
      reply_markup: buildPermissionListKeyboard(safePage, totalPages),
    }

    if (messageId) {
      return safeEditMessageText({
        ...payload,
        message_id: messageId,
      })
    }

    return sendMessage(payload)
  }

  async function showPermissionEditor(chatId, page = 1) {
    return renderPermissionEditor({
      selectedChatId: chatId,
      page,
      chatId: adminUid,
      messageId: null,
    })
  }

  async function renderPermissionEditor({ selectedChatId, page = 1, chatId, messageId = null }) {
    const [profile, permissionStatus] = await Promise.all([
      getUserProfile(selectedChatId),
      getUserPermissionStatus(selectedChatId),
    ])

    const payload = {
      chat_id: chatId,
      text: buildPermissionEditorText(profile, permissionStatus, selectedChatId),
      reply_markup: buildPermissionEditKeyboard(selectedChatId, page),
    }

    if (messageId) {
      return safeEditMessageText({
        ...payload,
        message_id: messageId,
      })
    }

    return sendMessage(payload)
  }

  async function handlePermissionListSelection(text, adminState) {
    const selection = Number(text)
    if (!Number.isInteger(selection) || selection <= 0) {
      return sendMessage({
        chat_id: adminUid,
        text: '请输入当前页中的有效序号。',
      })
    }

    const visibleUserIds = Array.isArray(adminState.visibleUserIds) ? adminState.visibleUserIds : []
    const selectedChatId = visibleUserIds[selection - 1]
    if (!selectedChatId) {
      return sendMessage({
        chat_id: adminUid,
        text: '该序号超出当前页范围，请重新输入。',
      })
    }

    return showPermissionEditor(selectedChatId, adminState.page || 1)
  }

  async function handleAdminPermissionUi(message, adminState) {
    const text = (message.text || '').trim()
    if (!text || adminState?.mode !== 'permission-list') return false
    if (/^\d+$/.test(text)) {
      await handlePermissionListSelection(text, adminState)
      return true
    }
    return false
  }

  async function handleWelcomeCallback(query, requestOrigin = '') {
    const action = (query.data || '').split('|')[1]
    const chatId = query.message?.chat?.id || query.from?.id
    if (!chatId) {
      return answerCallbackQuery({
        callback_query_id: query.id,
        text: '无法识别当前会话。',
      })
    }

    const blockedState = await getBlockedState(chatId)
    if (blockedState.blocked) {
      if (!blockedState.blockInfo?.notifiedAt) {
        await sendMessage({
          chat_id: chatId,
          text: blockedState.blockInfo?.blockMessage || DEFAULTS.defaultBlockMessage,
        })
        await markBlockedUserNotified(chatId)
      }
      return answerCallbackQuery({
        callback_query_id: query.id,
        text: '你当前已被封禁。',
        show_alert: true,
      })
    }

    const responseText = WELCOME_RESPONSES[action]
    if (!responseText) {
      return answerCallbackQuery({
        callback_query_id: query.id,
        text: '未知操作。',
      })
    }

    await answerCallbackQuery({
      callback_query_id: query.id,
      text: '已发送说明',
    })
    await sendMessage({
      chat_id: chatId,
      text: responseText,
    })
    await markWelcomeSelection(chatId, action)
    return maybePromptCaptcha(chatId, requestOrigin)
  }

  async function handlePermissionListCallback(query) {
    const [, action] = (query.data || '').split('|')
    const chatId = query.message?.chat?.id
    const messageId = query.message?.message_id

    if (!chatId || !messageId) {
      return answerCallbackQuery({
        callback_query_id: query.id,
        text: '无法定位列表消息。',
      })
    }

    if (action === 'close') {
      await clearAdminUiState()
      await answerCallbackQuery({
        callback_query_id: query.id,
        text: '已关闭列表',
      })
      return safeEditMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: '已关闭权限列表。',
      })
    }

    const page = Number(action)
    if (!Number.isInteger(page) || page <= 0) {
      return answerCallbackQuery({
        callback_query_id: query.id,
        text: '页码无效。',
      })
    }

    await answerCallbackQuery({
      callback_query_id: query.id,
      text: `已切换到第 ${page} 页`,
    })
    return renderBlockedUsersPage({ page, chatId, messageId })
  }

  async function handlePermissionEditCallback(query) {
    const [, action, selectedChatId, pageText] = (query.data || '').split('|')
    const chatId = query.message?.chat?.id
    const messageId = query.message?.message_id
    const page = Number(pageText) || 1

    if (!chatId || !messageId || !selectedChatId) {
      return answerCallbackQuery({
        callback_query_id: query.id,
        text: '无法定位权限消息。',
      })
    }

    if (action === 'whitelist') {
      await setWhitelistState(selectedChatId, {
        source: 'admin',
        addedAt: new Date().toISOString(),
      })
      await answerCallbackQuery({
        callback_query_id: query.id,
        text: '已设为白名单',
      })
      return renderPermissionEditor({
        selectedChatId,
        page,
        chatId,
        messageId,
      })
    }

    if (action === 'blacklist') {
      await setBlockedState(selectedChatId, {
        source: 'manual',
        blockMessage: DEFAULTS.manualBlockMessage,
        blockedAt: new Date().toISOString(),
        notifiedAt: null,
      })
      await answerCallbackQuery({
        callback_query_id: query.id,
        text: '已设为黑名单',
      })
      return renderPermissionEditor({
        selectedChatId,
        page,
        chatId,
        messageId,
      })
    }

    if (action === 'normal') {
      await clearBlockedState(selectedChatId)
      await clearWhitelistState(selectedChatId)
      await answerCallbackQuery({
        callback_query_id: query.id,
        text: '已设为普通用户',
      })
      return renderPermissionEditor({
        selectedChatId,
        page,
        chatId,
        messageId,
      })
    }

    if (action === 'back') {
      await answerCallbackQuery({
        callback_query_id: query.id,
        text: '已返回列表',
      })
      return renderBlockedUsersPage({
        page,
        chatId,
        messageId,
      })
    }

    if (action === 'close') {
      await answerCallbackQuery({
        callback_query_id: query.id,
        text: '已关闭面板',
      })
      return safeEditMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: '已关闭当前用户权限面板。',
      })
    }

    return answerCallbackQuery({
      callback_query_id: query.id,
      text: '未知权限操作。',
    })
  }

  async function handleBanRulesCallback(query) {
    const [, action, value, pageText] = (query.data || '').split('|')
    const chatId = query.message?.chat?.id
    const messageId = query.message?.message_id
    const page = Number(pageText || value) || 1

    if (!chatId || !messageId) {
      return answerCallbackQuery({
        callback_query_id: query.id,
        text: '无法定位规则消息。',
      })
    }

    if (action === 'close') {
      await answerCallbackQuery({
        callback_query_id: query.id,
        text: '已关闭规则列表',
      })
      return safeEditMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: '已关闭黑名单规则列表。',
      })
    }

    if (action === 'page') {
      await answerCallbackQuery({
        callback_query_id: query.id,
        text: `已切换到第 ${page} 页`,
      })
      return renderBanRulesPage({ page, chatId, messageId })
    }

    if (action === 'delete') {
      const ruleId = value
      const rules = await getBanRules()
      const nextRules = rules.filter(rule => rule.id !== ruleId)
      if (nextRules.length === rules.length) {
        await answerCallbackQuery({
          callback_query_id: query.id,
          text: '规则不存在或已被删除。',
        })
        return renderBanRulesPage({ page, chatId, messageId })
      }
      await saveBanRules(nextRules)
      await answerCallbackQuery({
        callback_query_id: query.id,
        text: '规则已删除',
      })
      return renderBanRulesPage({ page, chatId, messageId })
    }

    return answerCallbackQuery({
      callback_query_id: query.id,
      text: '未知规则操作。',
    })
  }

  async function handleAutoUnbanCallback(query) {
    const [, chatId] = (query.data || '').split('|')
    const messageChatId = query.message?.chat?.id
    const messageId = query.message?.message_id

    if (!chatId || !messageChatId || !messageId) {
      return answerCallbackQuery({
        callback_query_id: query.id,
        text: '无法定位封禁提醒。',
      })
    }

    await clearBlockedState(chatId)
    await answerCallbackQuery({
      callback_query_id: query.id,
      text: '已一键解封',
    })

    const text = query.message?.text || '自动封禁提醒'
    return safeEditMessageText({
      chat_id: messageChatId,
      message_id: messageId,
      text: `${text}\n\n处理结果：已通过按钮一键解封。`,
    })
  }

  async function handleCallbackQuery(query, requestOrigin = '') {
    const data = query.data || ''
    const prefix = data.split('|')[0]

    if (prefix === CALLBACK_PREFIX.welcome) {
      return handleWelcomeCallback(query, requestOrigin)
    }

    if (String(query.from?.id || '') !== adminUid) {
      return answerCallbackQuery({
        callback_query_id: query.id,
        text: '无权执行此操作。',
        show_alert: true,
      })
    }

    if (prefix === CALLBACK_PREFIX.permissionList) {
      return handlePermissionListCallback(query)
    }

    if (prefix === CALLBACK_PREFIX.permissionEdit) {
      return handlePermissionEditCallback(query)
    }

    if (prefix === CALLBACK_PREFIX.banRules) {
      return handleBanRulesCallback(query)
    }

    if (prefix === CALLBACK_PREFIX.autoUnban) {
      return handleAutoUnbanCallback(query)
    }

    return answerCallbackQuery({
      callback_query_id: query.id,
      text: '未知操作。',
    })
  }

  async function sendWeeklyBanSummary({ referenceTime = Date.now(), force = false } = {}) {
    const bucket = getPreviousWeekBucket(referenceTime)
    const { stats, weekStats } = await getWeekStats(bucket)

    if (weekStats.sentAt && !force) {
      return null
    }

    const result = await sendMessage({
      chat_id: adminUid,
      text: buildWeeklySummaryText(weekStats),
    })

    if (result && result.ok) {
      weekStats.sentAt = new Date(referenceTime).toISOString()
      stats.weeks[bucket.key] = weekStats
      trimBanStats(stats)
      await saveBanStats(stats)
    }

    return result
  }

  async function sendCurrentBanSummary(referenceTime = Date.now()) {
    const bucket = getWeekBucket(referenceTime)
    const [activeStats, { weekStats }] = await Promise.all([
      getActiveBlockedSummary(),
      getWeekStats(bucket),
    ])
    return sendMessage({
      chat_id: adminUid,
      text: buildCurrentBanSummaryText(activeStats, weekStats),
    })
  }

  async function sendAdminUsage(text = getAdminHelpText()) {
    return sendMessage({
      chat_id: adminUid,
      text,
    })
  }

  async function handleAddBanRule(message) {
    const text = (message.text || '').trim()
    const payload = parseBanRuleAddCommand(text)
    if (!payload) {
      return sendAdminUsage(`命令格式错误，请使用：\n/banrule_add 关键词 || 命中后回复语`)
    }

    const mode = payload.mode || 'contains'

    const rules = await getBanRules()
    const exists = rules.find(rule => rule.mode === mode && rule.pattern === payload.pattern)
    if (exists) {
      return sendMessage({
        chat_id: adminUid,
        text: `规则已存在：${formatRuleSummary(exists)}`,
      })
    }

    const rule = {
      id: crypto.randomUUID().slice(0, 8),
      mode,
      pattern: payload.pattern,
      flags: mode === 'regex' ? 'i' : '',
      reply: payload.reply,
      createdAt: new Date().toISOString(),
    }

    rules.push(rule)
    await saveBanRules(rules)

    return sendMessage({
      chat_id: adminUid,
      text: `规则新增成功：\n${formatRuleSummary(rule)}\n命中回复：${rule.reply}`,
    })
  }

  async function handleListBanRules() {
    return renderBanRulesPage({
      page: 1,
      chatId: adminUid,
      messageId: null,
    })
  }

  async function notifyAdminAutoBan(message, rule, blockInfo) {
    const content = extractMessageContent(message)
    return sendMessage({
      chat_id: adminUid,
      text: [
        '自动封禁提醒',
        `UID：${message.chat.id}`,
        `用户：${getGuestDisplayName(message.chat)}`,
        `规则：${formatRuleSummary(rule)}`,
        `时间：${blockInfo.blockedAt}`,
        `内容：${content ? shortenText(content) : '无文本内容'}`,
      ].join('\n'),
      reply_markup: buildInlineKeyboard([
        [
          {
            text: '✅ 一键解封',
            callback_data: `${CALLBACK_PREFIX.autoUnban}|${message.chat.id}`,
          },
        ],
      ]),
    })
  }

  async function handleKeywordAutoBlock(message) {
    const triggered = await findTriggeredBanRule(message)
    if (!triggered) return false

    const blockInfo = {
      source: 'keyword',
      ruleId: triggered.rule.id,
      ruleMode: triggered.rule.mode,
      rulePattern: triggered.rule.pattern,
      blockMessage: triggered.rule.reply || DEFAULTS.defaultBlockMessage,
      blockedAt: new Date().toISOString(),
      username: message.chat.username || '',
      name: getGuestShortName(message.chat),
    }

    const result = await setBlockedState(message.chat.id, blockInfo)
    if (!result.alreadyBlocked) {
      await sendMessage({
        chat_id: message.chat.id,
        text: result.blockInfo?.blockMessage || DEFAULTS.defaultBlockMessage,
      })
      await markBlockedUserNotified(message.chat.id)
    }
    await notifyAdminAutoBan(message, triggered.rule, result.blockInfo || blockInfo)
    return true
  }

  async function handleAdminMessage(message) {
    const text = (message.text || '').trim()
    const adminState = await getAdminUiState()

    if (await handleAdminPermissionUi(message, adminState)) {
      return true
    }

    if (/^\/banrule_help$/.test(text) || /^\/help$/.test(text)) {
      return sendAdminUsage()
    }
    if (/^\/banrule_add(?:\s|$)/.test(text)) {
      return handleAddBanRule(message)
    }
    if (/^\/banrule_list$/.test(text)) {
      return handleListBanRules()
    }
    if (/^\/banrule_add_(?:contains|exact|regex)(?:\s|$)/.test(text) || /^\/banrule_del\b/.test(text)) {
      return sendAdminUsage(
        '该旧版指令已停用。\n\n当前可用命令：\n' +
          '/banrule_add 关键词 || 命中后回复语\n' +
          '/banrule_list 查看当前黑名单规则列表，并可通过消息下方按钮删除规则\n' +
          '/banreport_now 立即查看本周实时封禁统计'
      )
    }
    if (/^\/banreport_now$/.test(text)) {
      const result = await sendCurrentBanSummary(Date.now())
      if (result && result.ok) {
        return result
      }
      return sendMessage({
        chat_id: adminUid,
        text: '周报发送失败，请检查管理员是否已经和机器人建立过会话。',
      })
    }
    if (new RegExp(`^${escapeRegExp(ADMIN_UI.command)}$`).test(text)) {
      return showBlockedUsersPage(1)
    }
    if (/^\/resetverify(?:@[\w_]+)?(?:\s+\d+)?$/.test(text)) {
      return handleResetVerify(message)
    }
    if (/^\/block$/.test(text)) {
      if (!message?.reply_to_message?.chat) {
        return sendAdminUsage()
      }
      return handleBlock(message)
    }
    if (/^\/unblock$/.test(text)) {
      if (!message?.reply_to_message?.chat) {
        return sendAdminUsage()
      }
      return handleUnBlock(message)
    }
    if (/^\/checkblock$/.test(text)) {
      if (!message?.reply_to_message?.chat) {
        return sendAdminUsage()
      }
      return checkBlock(message)
    }

    if (!message?.reply_to_message?.chat) {
      return sendAdminUsage()
    }

    const guestChatId = await kvGetJson(`msg-map-${message.reply_to_message.message_id}`)
    if (!guestChatId) {
      return sendMessage({
        chat_id: adminUid,
        text: '没有找到这条消息对应的用户，可能不是机器人转发出来的消息。',
      })
    }

    return copyMessage({
      chat_id: guestChatId,
      from_chat_id: message.chat.id,
      message_id: message.message_id,
    })
  }

  async function onMessage(message, requestOrigin = '') {
    if (message.web_app_data) {
      const handled = await handleWebAppVerificationMessage(message)
      if (handled) return
    }

    if (message.chat.id.toString() === adminUid) {
      return handleAdminMessage(message)
    }

    if (message.text === '/start') {
      await saveUserProfile(message.chat)
      const blockedState = await getBlockedState(message.chat.id)
      if (blockedState.blocked) {
        if (!blockedState.blockInfo?.notifiedAt) {
          await sendMessage({
            chat_id: message.chat.id,
            text: blockedState.blockInfo?.blockMessage || DEFAULTS.defaultBlockMessage,
          })
          await markBlockedUserNotified(message.chat.id)
        }
        return null
      }

      await sendWelcomeMenu(message.chat.id)
      return
    }

    return handleGuestMessage(message, requestOrigin)
  }

  async function handleGuestMessage(message, requestOrigin = '') {
    const chatId = message.chat.id
    await saveUserProfile(message.chat)

    const whitelistState = await getWhitelistState(chatId)
    if (whitelistState.whitelisted) {
      const forwardReq = await forwardMessage({
        chat_id: adminUid,
        from_chat_id: message.chat.id,
        message_id: message.message_id,
      })
      console.log(JSON.stringify(forwardReq))
      if (forwardReq.ok) {
        await kvPutJson(`msg-map-${forwardReq.result.message_id}`, chatId)
      }
      return handleNotify(message)
    }

    const blockedState = await getBlockedState(chatId)
    if (blockedState.blocked) {
      if (!blockedState.blockInfo?.notifiedAt) {
        await sendMessage({
          chat_id: chatId,
          text: blockedState.blockInfo?.blockMessage || DEFAULTS.defaultBlockMessage,
        })
        await markBlockedUserNotified(chatId)
      }
      return null
    }

    if (await handleKeywordAutoBlock(message)) {
      return
    }

    if (captchaEnabled) {
      const verified = await kvGetJson(`verified-${chatId}`)
      if (!verified) {
        if (!(await hasCompletedWelcomeSelection(chatId))) {
          await sendWelcomeMenu(chatId)
          return
        }
        await checkCaptchaAndMaybeVerify(message, requestOrigin)
        return
      }
    }

    const forwardReq = await forwardMessage({
      chat_id: adminUid,
      from_chat_id: message.chat.id,
      message_id: message.message_id,
    })
    console.log(JSON.stringify(forwardReq))
    if (forwardReq.ok) {
      await kvPutJson(`msg-map-${forwardReq.result.message_id}`, chatId)
    }
    return handleNotify(message)
  }

  async function handleNotify(message) {
    const chatId = message.chat.id
    if (enableNotification) {
      const lastMsgTime = await kvGetJson(`lastmsg-${chatId}`)
      if (!lastMsgTime || Date.now() - lastMsgTime > notifyIntervalMs) {
        await kvPutJson(`lastmsg-${chatId}`, Date.now())
        const text = await fetchText(notificationUrl, '')
        if (!text) return null
        return sendMessage({
          chat_id: adminUid,
          text,
        })
      }
    }
    return null
  }

  async function handleWebAppVerificationMessage(message) {
    const chatId = String(message.chat?.id || '')
    const rawData = String(message.web_app_data?.data || '')
    if (!chatId || !rawData) return false

    const grant = await verifyVerificationGrant(rawData, chatId)
    if (!grant || grant.kind !== 'turnstile_verified') {
      await sendMessage({
        chat_id: chatId,
        text: '验证回传无效，请重新点击验证按钮完成一次新的验证。',
        reply_markup: buildRemoveKeyboard(),
      })
      return true
    }

    const existingSession = await getVerificationSession(grant.sessionId)
    if (!existingSession || String(existingSession.chatId) !== chatId) {
      await sendMessage({
        chat_id: chatId,
        text: '验证会话不存在或已失效，请重新获取新的验证按钮。',
        reply_markup: buildRemoveKeyboard(),
      })
      return true
    }

    if (await isVerificationSessionStale(existingSession)) {
      await sendMessage({
        chat_id: chatId,
        text: '这次验证已经过期，请重新获取新的验证按钮。',
        reply_markup: buildRemoveKeyboard(),
      })
      return true
    }

    await kvPutJson(`verified-${chatId}`, true)
    await kvPutJson(`captcha-answer-${chatId}`, null)
    await kvPutJson(`captcha-attempts-${chatId}`, null)
    await consumeVerificationSession(grant.sessionId, {
      completedAt: existingSession.completedAt || new Date().toISOString(),
      handoffReceivedAt: new Date().toISOString(),
    })

    await sendMessage({
      chat_id: chatId,
      text: '✅ Cloudflare 验证通过！现在您可以正常对话啦。',
      reply_markup: buildRemoveKeyboard(),
    })
    return true
  }

  async function getGuestChatIdFromReply(message) {
    if (!message?.reply_to_message?.message_id) return null
    return kvGetJson(`msg-map-${message.reply_to_message.message_id}`)
  }

  async function handleResetVerify(message) {
    const text = (message.text || '').trim()
    const uidMatch = /^\/resetverify(?:@[\w_]+)?\s+(\d+)$/.exec(text)
    const guestChatId = uidMatch?.[1] || (await getGuestChatIdFromReply(message))

    if (!guestChatId) {
      return sendMessage({
        chat_id: adminUid,
        text: '请使用：/resetverify 用户UID\n或引用一条机器人转发出的用户消息后发送 /resetverify',
      })
    }

    await resetVerificationState(String(guestChatId))

    await sendMessage({
      chat_id: String(guestChatId),
      text: '管理员已重置你的验证状态。请重新发送 /start 或直接发送消息，按新用户流程重新完成验证。',
    })

    return sendMessage({
      chat_id: adminUid,
      text: `已重置用户 ${guestChatId} 的验证状态。该用户下次发送消息时会重新走欢迎与验证流程。`,
    })
  }

  async function handleBlock(message) {
    const guestChatId = await getGuestChatIdFromReply(message)
    if (!guestChatId) {
      return sendMessage({
        chat_id: adminUid,
        text: '未找到对应用户，无法屏蔽',
      })
    }
    if (String(guestChatId) === adminUid) {
      return sendMessage({
        chat_id: adminUid,
        text: '不能屏蔽自己',
      })
    }

    const result = await setBlockedState(guestChatId, {
      source: 'manual',
      blockMessage: DEFAULTS.manualBlockMessage,
      blockedAt: new Date().toISOString(),
    })

    if (result.alreadyBlocked) {
      return sendMessage({
        chat_id: adminUid,
        text: `UID:${guestChatId}当前已经是屏蔽状态`,
      })
    }

    return sendMessage({
      chat_id: adminUid,
      text: `UID:${guestChatId}屏蔽成功`,
    })
  }

  async function handleUnBlock(message) {
    const guestChatId = await getGuestChatIdFromReply(message)
    if (!guestChatId) {
      return sendMessage({
        chat_id: adminUid,
        text: '未找到对应用户，无法解除屏蔽',
      })
    }

    await clearBlockedState(guestChatId)
    return sendMessage({
      chat_id: adminUid,
      text: `UID:${guestChatId}解除屏蔽成功`,
    })
  }

  async function checkBlock(message) {
    const guestChatId = await getGuestChatIdFromReply(message)
    if (!guestChatId) {
      return sendMessage({
        chat_id: adminUid,
        text: '未找到对应用户，无法查询屏蔽状态',
      })
    }

    const blockedState = await getBlockedState(guestChatId)
    return sendMessage({
      chat_id: adminUid,
      text:
        `UID:${guestChatId}` +
        (blockedState.blocked ? '被屏蔽' : '没有被屏蔽'),
    })
  }

  async function onUpdate(update, requestOrigin = '') {
    if ('message' in update) {
      await onMessage(update.message, requestOrigin)
      return
    }
    if ('callback_query' in update) {
      await handleCallbackQuery(update.callback_query, requestOrigin)
    }
  }

  function isInternalRequestAuthorized(request) {
    const auth = request.headers.get('Authorization') || ''
    const internalSecret = request.headers.get('X-Internal-Secret') || ''
    return auth === `Bearer ${secret}` || internalSecret === secret
  }

  async function handleWebhook(request, ctx) {
    ensureConfigured()
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret) {
      return new Response('Unauthorized', { status: 403 })
    }

    const update = await request.json()
    ctx.waitUntil(onUpdate(update, new URL(request.url).origin))
    return new Response('Ok')
  }

  async function registerWebhook(requestUrl) {
    ensureConfigured()
    const webhookUrl = `${requestUrl.origin}${webhookPath}`
    const response = await fetch(
      apiUrl('setWebhook', { url: webhookUrl, secret_token: secret })
    )
    const result = await response.json()
    return new Response('ok' in result && result.ok ? 'Ok' : JSON.stringify(result, null, 2))
  }

  async function unRegisterWebhook() {
    ensureConfigured()
    const response = await fetch(apiUrl('setWebhook', { url: '' }))
    const result = await response.json()
    return new Response('ok' in result && result.ok ? 'Ok' : JSON.stringify(result, null, 2))
  }

  async function handleInternalWeeklyReport(request) {
    ensureConfigured()
    if (!isInternalRequestAuthorized(request)) {
      return new Response('Unauthorized', { status: 403 })
    }

    const url = new URL(request.url)
    const force = url.searchParams.get('force') === '1'
    const scheduledAt = Number(url.searchParams.get('scheduled_at'))
    const result = await sendWeeklyBanSummary({
      referenceTime: Number.isFinite(scheduledAt) ? scheduledAt : Date.now(),
      force,
    })

    if (result && result.ok) {
      return new Response('Weekly report sent')
    }
    if (!result && !force) {
      return new Response('Weekly report skipped')
    }
    return new Response('Weekly report failed', { status: 500 })
  }

  async function handleVerificationPage(request) {
    if (!hasTurnstileConfig) {
      return new Response(
        renderVerificationPage({
          status: 'missing',
          title: '验证暂不可用',
          description: '管理员还没有完成 Cloudflare Turnstile 配置，请稍后重试。',
        }),
        {
          status: 503,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
          },
        }
      )
    }

    const url = new URL(request.url)
    const sessionId = url.searchParams.get('session') || ''
    const session = await getVerificationSession(sessionId)
    const headers = {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    }

    if (!session) {
      return new Response(
        renderVerificationPage({
          status: 'missing',
          title: '验证链接无效',
          description: '这个验证链接不存在，请回到 Telegram 重新获取新的验证按钮。',
        }),
        { status: 404, headers }
      )
    }

    if (await isVerificationSessionStale(session)) {
      return new Response(
        renderVerificationPage({
          sessionId,
          status: 'expired',
          title: '验证链接已过期',
          description: '这个验证链接已过期，请回到 Telegram 重新获取新的验证按钮。',
        }),
        { status: 410, headers }
      )
    }

    if (session.completedAt || (await kvGetJson(`verified-${session.chatId}`))) {
      return new Response(
        renderVerificationPage({
          sessionId,
          status: 'success',
          title: '验证已经完成',
          description: '当前账号已经通过验证，可以返回 Telegram 继续发送消息。',
        }),
        { status: 200, headers }
      )
    }

    return new Response(
      renderVerificationPage({
        sessionId,
        status: 'pending',
        title: '完成 Cloudflare 人机验证',
        description: '请在下方完成验证，成功后即可返回 Telegram 继续对话。',
        siteKey: turnstileSiteKey,
        submitPath: verificationSubmitPath,
        canRenderWidget: true,
      }),
      { status: 200, headers }
    )
  }

  async function handleVerificationSubmit(request) {
    if (!hasTurnstileConfig) {
      return jsonResponse(
        {
          ok: false,
          message: '管理员还没有完成 Cloudflare Turnstile 配置。',
        },
        503
      )
    }

    let body = null
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ ok: false, message: '请求格式错误。' }, 400)
    }

    const sessionId = String(body?.session || '').trim()
    const tokenValue = String(body?.token || '').trim()
    const transport = String(body?.transport || 'direct').trim()

    if (!sessionId || !tokenValue) {
      return jsonResponse({ ok: false, message: '缺少验证参数。' }, 400)
    }

    const session = await getVerificationSession(sessionId)
    if (!session) {
      return jsonResponse({ ok: false, message: '验证链接无效，请回到 Telegram 重新获取。' }, 404)
    }

    if (await isVerificationSessionStale(session)) {
      return jsonResponse({ ok: false, message: '验证链接已过期，请回到 Telegram 重新获取。' }, 410)
    }

    if (session.completedAt || (await kvGetJson(`verified-${session.chatId}`))) {
      return jsonResponse({
        ok: true,
        message: '验证已经完成，可以返回 Telegram 继续发送消息。',
      })
    }

    const verifyFormData = new FormData()
    verifyFormData.append('secret', turnstileSecretKey)
    verifyFormData.append('response', tokenValue)
    const remoteIp = getRemoteIp(request)
    if (remoteIp) {
      verifyFormData.append('remoteip', remoteIp)
    }
    verifyFormData.append('idempotency_key', crypto.randomUUID())

    let validation = null
    try {
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: verifyFormData,
      })
      validation = await response.json()
    } catch (error) {
      console.error('turnstile validation failed', error)
      return jsonResponse({ ok: false, message: 'Cloudflare 验证服务暂时不可用，请稍后再试。' }, 502)
    }

    const expectedHostname = new URL(request.url).hostname
    if (
      !validation?.success ||
      (validation.hostname && validation.hostname !== expectedHostname)
    ) {
      return jsonResponse(
        {
          ok: false,
          message: '验证未通过，请刷新页面后重试。',
          errors: validation?.['error-codes'] || [],
        },
        400
      )
    }

    const chatId = session.chatId
    const completedAt = new Date().toISOString()
    await consumeVerificationSession(sessionId, {
      completedAt,
      hostname: validation.hostname || '',
      remoteIp,
      transport,
    })

    if (transport === 'webapp') {
      const handoffPayload = await signVerificationGrant({
        kind: 'turnstile_verified',
        chatId: String(chatId),
        sessionId,
        issuedAtMs: Date.now(),
        expiresAtMs: Date.now() + 10 * 60 * 1000,
      })

      return jsonResponse({
        ok: true,
        message: '验证已经完成，请点击按钮返回对话。',
        handoffPayload,
      })
    }

    await kvPutJson(`verified-${chatId}`, true)
    await kvPutJson(`captcha-answer-${chatId}`, null)
    await kvPutJson(`captcha-attempts-${chatId}`, null)
    await sendMessage({
      chat_id: chatId,
      text: '✅ Cloudflare 验证通过！现在您可以正常对话啦。',
      reply_markup: buildRemoveKeyboard(),
    })

    return jsonResponse({
      ok: true,
      message: '验证成功，请返回 Telegram 继续发送消息。',
    })
  }

  async function handleRequest(request, ctx) {
    const url = new URL(request.url)

    if (url.pathname === webhookPath) {
      return handleWebhook(request, ctx)
    }

    if (url.pathname === '/registerWebhook') {
      if (!isInternalRequestAuthorized(request)) {
        return new Response('Unauthorized', { status: 403 })
      }
      return registerWebhook(url)
    }

    if (url.pathname === '/unRegisterWebhook') {
      if (!isInternalRequestAuthorized(request)) {
        return new Response('Unauthorized', { status: 403 })
      }
      return unRegisterWebhook()
    }

    if (url.pathname === internalWeeklyReportPath) {
      return handleInternalWeeklyReport(request)
    }

    if (url.pathname === verificationPagePath) {
      return handleVerificationPage(request)
    }

    if (url.pathname === verificationSubmitPath) {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 })
      }
      return handleVerificationSubmit(request)
    }

    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request)
    }

    return new Response('No handler for this request', { status: 404 })
  }

  async function handleScheduled(controller, ctx) {
    ensureConfigured()
    ctx.waitUntil(
      sendWeeklyBanSummary({
        referenceTime: controller.scheduledTime || Date.now(),
        force: false,
      })
    )
  }

  return {
    handleRequest,
    handleScheduled,
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function toBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback
  }
  if (typeof value === 'boolean') return value
  return String(value).toLowerCase() !== 'false'
}

function toPositiveNumber(value, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}
