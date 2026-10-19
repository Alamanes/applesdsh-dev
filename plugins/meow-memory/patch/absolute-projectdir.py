#!/usr/bin/env python3
"""给 meow-memory 的构建产物打上「projectDir 支持绝对路径」补丁。

默认目标是 DSH desktop profile 里安装的那份，也可以显式指定任意已构建的包目录：

    python3 absolute-projectdir.py                          # ~/.dsh/profiles/desktop/node_modules/meow-memory
    python3 absolute-projectdir.py /path/to/meow-memory     # 任意包目录

补丁新增 dataDir(workspace, dir)：dir 为绝对路径时直接返回它，否则维持上游的
「按工作区拼接」。随后让 9 处路径拼接改走 dataDir，使 projectDir 可以用绝对路径表达，
从而让所有工作区共用同一个记忆库目录，工作区里不再出现 .dsh-meow。

可重复执行：已经打过补丁的产物匹配不到原文，脚本会直接退出且不写入。
"""
import os
import sys

target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.expanduser("~"), ".dsh", "profiles", "desktop", "node_modules", "meow-memory")

src_path = os.path.join(target, "lib", "index.js")
if not os.path.isfile(src_path):
    sys.exit(f"找不到产物文件：{src_path}")

src = open(src_path, encoding="utf-8").read()
orig = src

SUBS = [
    # 1) 新增 dataDir()，并让库文件路径走它
    ('function memoryDbPath(workspace, dir = ".dsh-meow") {\n'
     '  return join3(workspace, dir, "memory.db");\n'
     '}',
     '/** 记忆数据的根目录：projectDir 为绝对路径时直接用它，否则按工作区拼接。 */\n'
     'function dataDir(workspace, dir = ".dsh-meow") {\n'
     '  return isAbsolute(dir) ? dir : join3(workspace, dir);\n'
     '}\n'
     'function memoryDbPath(workspace, dir = ".dsh-meow") {\n'
     '  return join3(dataDir(workspace, dir), "memory.db");\n'
     '}'),

    # 2) 会话状态文件 sessions/<sid>.json
    ('function sessionsFile(workspace, sessionId, dir = ".dsh-meow") {\n'
     '  return join5(workspace, dir, "sessions", `${sessionId}.json`);\n'
     '}',
     'function sessionsFile(workspace, sessionId, dir = ".dsh-meow") {\n'
     '  return join5(dataDir(workspace, dir), "sessions", `${sessionId}.json`);\n'
     '}'),

    # 3) dreamLog
    ('appendFileSync(join6(ws, dir, "dream-debug.log")',
     'appendFileSync(join6(dataDir(ws, dir), "dream-debug.log")'),

    # 4) 旧库迁移读 PROJECT.md
    ('const projectFile = join7(workspace, dir, "PROJECT.md");',
     'const projectFile = join7(dataDir(workspace, dir), "PROJECT.md");'),

    # 5) pre-step / hit-chain 的 dream-debug.log（内联）
    ('join8(ws, resolved.projectDir, "dream-debug.log")',
     'join8(dataDir(ws, resolved.projectDir), "dream-debug.log")'),

    # 6) turn-stopping 的 dream-debug.log（内联）
    ('join8(wsTs, resolved.projectDir, "dream-debug.log")',
     'join8(dataDir(wsTs, resolved.projectDir), "dream-debug.log")'),

    # 7) PROJECT.md 自动迁移判定（内联）
    ('join8(ws, resolved.projectDir, "PROJECT.md")',
     'join8(dataDir(ws, resolved.projectDir), "PROJECT.md")'),

    # 8) 首次建库提示里的 dbPath
    ('join8(ws, resolved.projectDir, "memory.db")',
     'join8(dataDir(ws, resolved.projectDir), "memory.db")')
]

for old, new in SUBS:
    n = src.count(old)
    print(f"命中 {n} 处 | {old.splitlines()[0][:70]}")
    if n == 0:
        sys.exit("未命中，放弃写入（可能已经打过补丁）：" + old.splitlines()[0][:70])
    src = src.replace(old, new)

open(src_path, "w", encoding="utf-8").write(src)
print(f"已写入 {src_path}：{len(orig)} -> {len(src)} 字符")
print("提示：若宿主正在运行，需要重启 dsh 才会读到新产物。")
