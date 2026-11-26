--[[
Vorix Probe — diagnóstico do que ESTE build do DaVinci Resolve permite ao Lua.
Rodar em Workspace > Scripts > VorixProbe (contexto "menu") e, se possível, no Console.
Não cria projeto, não altera nada no DaVinci, não executa código recebido.
Só testa a existência de primitivas e grava o resultado por todos os canais disponíveis:
  1. arquivo   <BRIDGE_ROOT>\probe-<contexto>.json   (se io existir)
  2. Fusion.prefs  chave VorixProbe.<contexto>      (se fusion:SetData existir)
  3. print no Console
]]

local BRIDGE_ROOT = "__VORIX_BRIDGE_ROOT__"
local SEP = "__VORIX_PATH_SEP__"
local CONTEXT = VORIX_PROBE_CONTEXT or "menu"

local r = { context = CONTEXT, checks = {} }
local function mark(name, value) r.checks[name] = value end
local function kind(v) return type(v) end

-- Primitivas da linguagem (só o tipo; nada é chamado aqui)
mark("io", kind(io))
mark("io.open", io and kind(io.open) or "nil")
mark("os", kind(os))
mark("os.rename", os and kind(os.rename) or "nil")
mark("os.remove", os and kind(os.remove) or "nil")
mark("os.time", os and kind(os.time) or "nil")
mark("os.clock", os and kind(os.clock) or "nil")
mark("os.getenv", os and kind(os.getenv) or "nil")
mark("dofile", kind(dofile))
mark("loadfile", kind(loadfile))
mark("require", kind(require))
mark("bmd", kind(bmd))
if bmd then
  for _, name in ipairs({ "wait", "readfile", "writefile", "readdir", "fileexists", "direxists", "createdir", "gettime", "scriptapp", "openfileexternal" }) do
    mark("bmd." .. name, kind(bmd[name]))
  end
end
local fu_obj = fusion or fu or app
mark("fusion", kind(fu_obj))

-- Objeto Resolve por todos os caminhos conhecidos
local resolve_obj, via = nil, nil
local attempts = {
  { "global resolve", function() return resolve end },
  { "Resolve()", function() return Resolve and Resolve() end },
  { "bmd.scriptapp", function() return bmd and bmd.scriptapp and bmd.scriptapp("Resolve") end },
  { "fusion:GetResolve()", function() return fu_obj and fu_obj.GetResolve and fu_obj:GetResolve() end },
}
for _, attempt in ipairs(attempts) do
  local ok, value = pcall(attempt[2])
  mark("resolve via " .. attempt[1], ok and kind(value) or ("erro: " .. tostring(value)))
  if ok and value and not resolve_obj then resolve_obj, via = value, attempt[1] end
end
r.resolveVia = via
if resolve_obj then
  pcall(function() r.product = resolve_obj:GetProductName() end)
  pcall(function() r.version = resolve_obj:GetVersionString() end)
  pcall(function() mark("projectManager", kind(resolve_obj:GetProjectManager())) end)
  pcall(function()
    local storage = resolve_obj:GetMediaStorage()
    mark("mediaStorage", kind(storage))
    local folders = storage and storage:GetSubFolderList(BRIDGE_ROOT)
    mark("mediaStorage.listRoot", folders and #folders or "nil")
  end)
end

-- Leitura de arquivo pelos caminhos possíveis (sentinela criada pelo instalador)
local sentinel = BRIDGE_ROOT .. SEP .. "probe-sentinel.txt"
if io and io.open then
  local ok, content = pcall(function()
    local f = io.open(sentinel, "rb")
    if not f then return nil end
    local data = f:read("*a")
    f:close()
    return data
  end)
  mark("read.io", ok and (content and ("ok:" .. #content) or "nil") or "erro")
end
if bmd and bmd.readfile then
  local ok, content = pcall(bmd.readfile, sentinel)
  mark("read.bmd.readfile", ok and kind(content) or "erro")
end
if loadfile then
  local ok, fn = pcall(loadfile, BRIDGE_ROOT .. SEP .. "probe-data.lua")
  mark("read.loadfile", ok and kind(fn) or "erro")
end

-- Serializa (JSON simples)
local function enc(v)
  local t = type(v)
  if t == "table" then
    local parts = {}
    for k, val in pairs(v) do parts[#parts + 1] = string.format("%q", tostring(k)) .. ":" .. enc(val) end
    return "{" .. table.concat(parts, ",") .. "}"
  elseif t == "number" or t == "boolean" then
    return tostring(v)
  elseif v == nil then
    return "null"
  end
  return string.format("%q", tostring(v))
end
local payload = enc(r)

-- Canal 1: arquivo
local wrote_file = false
if io and io.open then
  pcall(function()
    local f = io.open(BRIDGE_ROOT .. SEP .. "probe-" .. CONTEXT .. ".json", "wb")
    if f then f:write(payload) f:close() wrote_file = true end
  end)
end
-- Canal 2: Fusion.prefs
local wrote_prefs = false
if fu_obj and fu_obj.SetData then
  pcall(function()
    fu_obj:SetData("VorixProbe." .. CONTEXT, payload)
    if fu_obj.SavePrefs then fu_obj:SavePrefs() end
    wrote_prefs = true
  end)
end
-- Canal 3: console
print("[VorixProbe] " .. CONTEXT .. " arquivo=" .. tostring(wrote_file) .. " prefs=" .. tostring(wrote_prefs))
print(payload)
