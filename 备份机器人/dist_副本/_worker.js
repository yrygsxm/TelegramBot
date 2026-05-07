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
  const notifyIntervalMs = toPositiveNumber(
    env.NOTIFY_INTERVAL_MS,
    DEFAULTS.notifyIntervalMs
  )
  const notificationUrl = env.NOTIFICATION_URL || DEFAULTS.notificationUrl
  const startMsgUrl = env.START_MSG_URL || DEFAULTS.startMsgUrl
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
      '3. 关键词黑名单命令：',
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

  async function sendCaptcha(chatId, forceNew = false) {
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

  async function checkCaptchaAndMaybeVerify(message) {
    const chatId = message.chat.id
    const text = (message.text || '').trim()

    if (/^\/captcha$/.test(text)) {
      await sendCaptcha(chatId, true)
      return { verified: false }
    }

    const ansKey = `captcha-answer-${chatId}`
    const attKey = `captcha-attempts-${chatId}`
    const answerObj = await kvGetJson(ansKey)
    const attempts = await kvGetJson(attKey)

    if (!answerObj) {
      await sendCaptcha(chatId, true)
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
      await sendCaptcha(chatId, true)
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

  async function maybePromptCaptcha(chatId) {
    if (!captchaEnabled) return null
    const whitelistState = await getWhitelistState(chatId)
    if (whitelistState.whitelisted) return null
    const verified = await kvGetJson(`verified-${chatId}`)
    if (verified) return null
    if (!(await hasCompletedWelcomeSelection(chatId))) return null
    return sendCaptcha(chatId, false)
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

  async function handleWelcomeCallback(query) {
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
    return maybePromptCaptcha(chatId)
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

  async function handleCallbackQuery(query) {
    const data = query.data || ''
    const prefix = data.split('|')[0]

    if (prefix === CALLBACK_PREFIX.welcome) {
      return handleWelcomeCallback(query)
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

  async function onMessage(message) {
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

    return handleGuestMessage(message)
  }

  async function handleGuestMessage(message) {
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
        await checkCaptchaAndMaybeVerify(message)
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

  async function handleBlock(message) {
    const guestChatId = await kvGetJson(`msg-map-${message.reply_to_message.message_id}`)
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
    const guestChatId = await kvGetJson(`msg-map-${message.reply_to_message.message_id}`)
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
    const guestChatId = await kvGetJson(`msg-map-${message.reply_to_message.message_id}`)
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

  async function onUpdate(update) {
    if ('message' in update) {
      await onMessage(update.message)
      return
    }
    if ('callback_query' in update) {
      await handleCallbackQuery(update.callback_query)
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
    ctx.waitUntil(onUpdate(update))
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
