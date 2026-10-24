/**
 * dsh-agent-room host half.
 *
 * 一个房间：用户说一句话，房间里的角色按顺序接话，后说的看得到前面说的。
 * 浏览器半区只负责画，房间状态与模型调用都在这一侧，所以关掉页面不丢。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHANNEL = '/api'
const ENDPOINT = 'dsh-agent-room/send'
const ROUTE_PATH = CHANNEL + '/' + ENDPOINT
const HISTORY_LIMIT = 40
const MAX_TOKENS = 400

/** 默认的三个角色；配置里给了 bots 就整组替换。 */
const DEFAULT_BOTS = [
  {
    id: 'chief',
    name: 'Chief',
    role: '主持',
    color: '#4d6bfe',
    persona:
      '你是这间屋子的主持人。说话短，先接住用户的话，给出方向或一句判断，必要时点名房间里的其他人接下去。不要复述别人已经说过的话。',
  },
  {
    id: 'coder',
    name: 'Coder',
    role: '工程',
    color: '#2f9e8f',
    persona:
      '你负责工程实现。回答具体、可执行，给方案和步骤，不客套不铺垫。不知道就说不知道，不编造接口和文件。',
  },
  {
    id: 'critic',
    name: 'Critic',
    role: '审查',
    color: '#c9774a',
    persona:
      '你专门挑毛病。指出风险、遗漏和会被推翻的地方，一条一句，直接说。认可的时候也要说清楚认可哪一点。',
  },
]

/**
 * 一条 stream 里的文本分片。
 * @param chunk - 模型流返回的分片。
 * @returns 本片携带的文本，没有就是空串。
 */
function chunkText(chunk) {
  if (typeof chunk === 'string') return chunk
  if (chunk === null || typeof chunk !== 'object') return ''
  for (const key of ['text', 'textDelta', 'delta', 'content']) {
    const value = chunk[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return ''
}

/**
 * 从已挂载的适配器里挑一个可用的 provider/model。
 * @param config - 插件配置，可显式指定 provider 与 model。
 * @returns 目标，缺字段时为 undefined。
 */
function resolveTarget(llm, config) {
  const wanted = { provider: config?.provider, model: config?.model }
  if (typeof wanted.provider === 'string' && typeof wanted.model === 'string') return wanted
  let providers = []
  try {
    providers = llm?.listProviders?.() ?? []
  } catch {
    providers = []
  }
  const first = providers[0]
  const provider =
    wanted.provider ??
    (typeof first === 'string' ? first : first?.id ?? first?.provider ?? first?.name ?? undefined)
  if (typeof provider !== 'string') return undefined
  if (typeof wanted.model === 'string') return { provider, model: wanted.model }
  let models = []
  try {
    models = llm?.listModels?.(provider) ?? []
  } catch {
    models = []
  }
  const firstModel = models[0]
  const model =
    typeof firstModel === 'string' ? firstModel : firstModel?.id ?? firstModel?.model ?? undefined
  return typeof model === 'string' ? { provider, model } : undefined
}

/**
 * 让一个角色就当前对话说一句。
 * @param llm - 模型服务。
 * @param target - provider 与 model。
 * @param bot - 这个角色。
 * @param room - 房间里的最近发言，旧到新。
 * @param userText - 用户刚说的话。
 * @returns 这个角色的发言文本。
 */
async function speak(llm, target, bot, room, userText) {
  const transcript = room
    .slice(-HISTORY_LIMIT)
    .map((entry) => entry.name + '：' + entry.text)
    .join('\n')
  const system = [
    bot.persona,
    '',
    '规则：',
    '- 这是一间多人群聊，你的每一句都会被其它人看到。',
    '- 只用中文，一到三句话，不超过 120 字，不写标题不写列表。',
    '- 别人说过的不要重复，接着往下说。',
    transcript === '' ? '' : '\n目前屋里的对话：\n' + transcript,
  ].join('\n')

  let text = ''
  const stream = llm.stream({
    provider: target.provider,
    model: target.model,
    maxTokens: MAX_TOKENS,
    messages: [
      { role: 'system', content: [{ type: 'text', text: system }] },
      { role: 'user', content: [{ type: 'text', text: userText }] },
    ],
  })
  for await (const chunk of stream) {
    text += chunkText(chunk)
  }
  return text.trim()
}

/**
 * 读房间的落盘状态。
 * @returns 历史发言数组。
 */
function readRoom(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(parsed?.messages) ? parsed.messages : []
  } catch {
    return []
  }
}

/**
 * 把房间状态写回磁盘；失败不影响这一轮对话。
 * @param file - 目标文件。
 * @param messages - 全部发言。
 */
function writeRoom(file, messages) {
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ messages: messages.slice(-200) }, null, 2))
  } catch {
    // 落盘只是锦上添花，这一轮照常返回。
  }
}

/**
 * 挂载房间服务。
 * @param ctx - 宿主上下文。
 * @param config - 插件配置。
 */
export function apply(ctx, config) {
  const bots =
    Array.isArray(config?.bots) && config.bots.length > 0 ? config.bots : DEFAULT_BOTS
  const file = path.join(
    process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'),
    'storages',
    'dsh-agent-room',
    'room.json',
  )
  const messages = readRoom(file)

  ctx.inject(['connection'], (scope) => {
    const ok = (rpcId, value) => Response.json({ type: 'server-response', rpcId, result: { ok: true, value } })
    const fail = (rpcId, code, message) =>
      Response.json({ type: 'server-response', rpcId, result: { ok: false, error: { code, message } } })

    /** 读一个 client-request 信封并作答。 */
    const serve = async (request) => {
      if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 })
      }
      let body
      try {
        body = await request.json()
      } catch {
        return new Response('body is not JSON', { status: 400 })
      }
      const rpcId = typeof body?.rpcId === 'string' ? body.rpcId : 'invalid-request'
      if (body?.type !== 'client-request' || body?.method !== ENDPOINT) {
        return fail(rpcId, 'bad-request', 'unexpected request')
      }

      const params = body.params ?? {}
      const text = typeof params.text === 'string' ? params.text.trim() : ''
      if (text === '') return fail(rpcId, 'empty', '说点什么再发')

      const llm = scope.get('llm') ?? scope.llm
      if (llm === undefined) return fail(rpcId, 'no-llm', '模型服务不可用')
      const target = resolveTarget(llm, config)
      if (target === undefined) return fail(rpcId, 'no-model', '没有可用的模型，先在设置里配一个')

      messages.push({ who: 'user', name: '你', text, at: Date.now() })
      const spoken = []
      try {
        for (const bot of bots) {
          const said = await speak(llm, target, bot, messages, text)
          const entry = {
            who: bot.id,
            name: bot.name,
            role: bot.role,
            color: bot.color,
            text: said === '' ? '……' : said,
            at: Date.now(),
          }
          messages.push(entry)
          spoken.push(entry)
        }
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason)
        return fail(rpcId, 'model-failed', message)
      }
      writeRoom(file, messages)
      return ok(rpcId, { bots: bots.map(({ id, name, role, color }) => ({ id, name, role, color })), messages: spoken })
    }

    scope.effect(
      () =>
        scope.connection.fetch.register({
          path: ROUTE_PATH,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: serve,
        }),
      'dsh-agent-room: route',
    )

    // 打开页面时把房间里的旧话还回去，界面不用从空白开始。
    scope.connection.fetch.register({
      path: CHANNEL + '/dsh-agent-room/room',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        let body
        try {
          body = await request.json()
        } catch {
          return new Response('body is not JSON', { status: 400 })
        }
        const rpcId = typeof body?.rpcId === 'string' ? body.rpcId : 'invalid-request'
        return Response.json({
          type: 'server-response',
          rpcId,
          result: {
            ok: true,
            value: {
              bots: bots.map(({ id, name, role, color }) => ({ id, name, role, color })),
              messages: messages.slice(-60),
            },
          },
        })
      },
    })
  })
}
