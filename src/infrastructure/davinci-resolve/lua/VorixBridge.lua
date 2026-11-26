--[[
Vorix Bridge para DaVinci Resolve (gratuito ou Studio) — protocolo v1.

Instalado por `scripts/davinci/install-bridge.mjs` em
  %APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility\VorixBridge.lua
e iniciado pelo operador em Workspace > Scripts > VorixBridge (o Resolve gratuito 21.1+ bloqueia
scripting externo e Python; só scripts Lua iniciados de dentro do app têm acesso à API).

Segurança (revisar antes de qualquer alteração):
- Só executa as operações da tabela OPS abaixo. Não existe operação de "rodar código".
- Nunca usa loadstring, load, dofile, require, os.execute nem io.popen. JSON é lido por um
  parser próprio que só produz dados.
- Caminhos são montados aqui, a partir de BRIDGE_ROOT (gravado na instalação) + jobId e nome de
  arquivo validados por padrão estrito. Nenhum caminho vem pronto do pedido.
- Sem rede: a comunicação é por arquivos dentro de BRIDGE_ROOT, um pedido por vez.
]]

local BRIDGE_ROOT = "__VORIX_BRIDGE_ROOT__"
local SEP = "__VORIX_PATH_SEP__"
local PROTOCOL = 1
local BRIDGE_VERSION = "1.0.0"
local POLL_SECONDS = 0.15
local BEAT_EVERY = 6 -- polls

-- Calibração de unidades do Fusion (ajustada na prova ao vivo; ver docs/davinci-resolve-integration.md).
local TEXT_SIZE_FACTOR = 1.0

local resolveApp = resolve or (Resolve and Resolve()) or (bmd and bmd.scriptapp and bmd.scriptapp("Resolve"))

---------------------------------------------------------------------------
-- JSON (somente dados)
---------------------------------------------------------------------------
local json = {}

local function decode_error(str, pos, msg)
  error("json: " .. msg .. " na posição " .. tostring(pos), 0)
end

local function skip_ws(str, pos)
  local _, e = string.find(str, "^[ \t\r\n]*", pos)
  return e + 1
end

local function utf8_char(code)
  if code < 0x80 then return string.char(code) end
  if code < 0x800 then return string.char(0xC0 + math.floor(code / 0x40), 0x80 + code % 0x40) end
  if code < 0x10000 then
    return string.char(0xE0 + math.floor(code / 0x1000), 0x80 + math.floor(code / 0x40) % 0x40, 0x80 + code % 0x40)
  end
  return string.char(0xF0 + math.floor(code / 0x40000), 0x80 + math.floor(code / 0x1000) % 0x40, 0x80 + math.floor(code / 0x40) % 0x40, 0x80 + code % 0x40)
end

local decode_value

local function decode_string(str, pos)
  local parts = {}
  local i = pos + 1
  while true do
    local c = string.sub(str, i, i)
    if c == "" then decode_error(str, i, "string não terminada") end
    if c == '"' then return table.concat(parts), i + 1 end
    if c == "\\" then
      local n = string.sub(str, i + 1, i + 1)
      local map = { ['"'] = '"', ["\\"] = "\\", ["/"] = "/", b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }
      if map[n] then
        parts[#parts + 1] = map[n]
        i = i + 2
      elseif n == "u" then
        local hex = string.sub(str, i + 2, i + 5)
        if not string.find(hex, "^%x%x%x%x$") then decode_error(str, i, "escape unicode inválido") end
        local code = tonumber(hex, 16)
        if code >= 0xD800 and code <= 0xDBFF then
          local low = string.sub(str, i + 8, i + 11)
          if string.sub(str, i + 6, i + 7) == "\\u" and string.find(low, "^%x%x%x%x$") then
            code = 0x10000 + (code - 0xD800) * 0x400 + (tonumber(low, 16) - 0xDC00)
            i = i + 6
          end
        end
        parts[#parts + 1] = utf8_char(code)
        i = i + 6
      else
        decode_error(str, i, "escape inválido")
      end
    else
      parts[#parts + 1] = c
      i = i + 1
    end
  end
end

local function decode_number(str, pos)
  local s, e = string.find(str, "^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
  if not s then decode_error(str, pos, "número inválido") end
  local n = tonumber(string.sub(str, s, e))
  if n == nil then decode_error(str, pos, "número inválido") end
  return n, e + 1
end

decode_value = function(str, pos, depth)
  if depth > 20 then decode_error(str, pos, "aninhamento excessivo") end
  pos = skip_ws(str, pos)
  local c = string.sub(str, pos, pos)
  if c == "{" then
    local obj = {}
    pos = skip_ws(str, pos + 1)
    if string.sub(str, pos, pos) == "}" then return obj, pos + 1 end
    while true do
      pos = skip_ws(str, pos)
      if string.sub(str, pos, pos) ~= '"' then decode_error(str, pos, "chave esperada") end
      local key
      key, pos = decode_string(str, pos)
      pos = skip_ws(str, pos)
      if string.sub(str, pos, pos) ~= ":" then decode_error(str, pos, "':' esperado") end
      local val
      val, pos = decode_value(str, pos + 1, depth + 1)
      obj[key] = val
      pos = skip_ws(str, pos)
      local d = string.sub(str, pos, pos)
      if d == "}" then return obj, pos + 1 end
      if d ~= "," then decode_error(str, pos, "',' esperado") end
      pos = pos + 1
    end
  elseif c == "[" then
    local arr = { __array = true }
    local n = 0
    pos = skip_ws(str, pos + 1)
    if string.sub(str, pos, pos) == "]" then return arr, pos + 1 end
    while true do
      local val
      val, pos = decode_value(str, pos, depth + 1)
      n = n + 1
      arr[n] = val
      pos = skip_ws(str, pos)
      local d = string.sub(str, pos, pos)
      if d == "]" then return arr, pos + 1 end
      if d ~= "," then decode_error(str, pos, "',' esperado") end
      pos = pos + 1
    end
  elseif c == '"' then
    return decode_string(str, pos)
  elseif c == "-" or string.find(c, "%d") then
    return decode_number(str, pos)
  elseif string.sub(str, pos, pos + 3) == "true" then
    return true, pos + 4
  elseif string.sub(str, pos, pos + 4) == "false" then
    return false, pos + 5
  elseif string.sub(str, pos, pos + 3) == "null" then
    return nil, pos + 4
  end
  decode_error(str, pos, "valor inesperado")
end

function json.decode(str)
  if type(str) ~= "string" or #str > 2000000 then error("json: entrada inválida", 0) end
  local value, pos = decode_value(str, 1, 0)
  pos = skip_ws(str, pos)
  if pos <= #str then decode_error(str, pos, "conteúdo após o fim") end
  return value
end

local function encode_string(s)
  s = string.gsub(s, '[%c"\\]', function(ch)
    local map = { ['"'] = '\\"', ["\\"] = "\\\\", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t" }
    return map[ch] or string.format("\\u%04x", string.byte(ch))
  end)
  return '"' .. s .. '"'
end

function json.encode(value, depth)
  depth = depth or 0
  if depth > 20 then return "null" end
  local t = type(value)
  if t == "nil" then return "null" end
  if t == "boolean" then return value and "true" or "false" end
  if t == "number" then
    if value ~= value or value == math.huge or value == -math.huge then return "null" end
    return string.format("%.10g", value)
  end
  if t == "string" then return encode_string(value) end
  if t == "table" then
    local is_array = value.__array or (#value > 0 and next(value, #value) == nil)
    local parts = {}
    if is_array then
      for i = 1, #value do parts[#parts + 1] = json.encode(value[i], depth + 1) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    for k, v in pairs(value) do
      if type(k) == "string" and k ~= "__array" then parts[#parts + 1] = encode_string(k) .. ":" .. json.encode(v, depth + 1) end
    end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return "null"
end

---------------------------------------------------------------------------
-- Arquivos (somente dentro de BRIDGE_ROOT)
---------------------------------------------------------------------------
local function root_path(...)
  return table.concat({ BRIDGE_ROOT, ... }, SEP)
end

local function read_file(path)
  if not io or not io.open then return nil end
  local f = io.open(path, "rb")
  if not f then return nil end
  local data = f:read("*a")
  f:close()
  return data
end

local function write_file(path, data)
  local tmp = path .. ".tmp"
  local f = io.open(tmp, "wb")
  if not f then return false end
  f:write(data)
  f:close()
  if os and os.rename then
    if os.remove then os.remove(path) end
    local ok = os.rename(tmp, path)
    if ok then return true end
  end
  local g = io.open(path, "wb")
  if not g then return false end
  g:write(data)
  g:close()
  return true
end

---------------------------------------------------------------------------
-- Validação (espelha bridge-protocol.ts)
---------------------------------------------------------------------------
local function fail(msg) error({ bridge = true, message = msg }, 0) end

local function is_int(v, min, max) return type(v) == "number" and v == math.floor(v) and v >= min and v <= max end
local function is_num(v, min, max) return type(v) == "number" and v == v and v >= min and v <= max end

local function valid_job(id)
  return type(id) == "string" and #id >= 3 and #id <= 64 and string.find(id, "^[a-z0-9][a-z0-9%-]*$") ~= nil
end
local function valid_ref(ref)
  return type(ref) == "string" and #ref >= 1 and #ref <= 64 and string.find(ref, "^[%w_%-]+$") ~= nil
end
local MEDIA_EXT = { mp4 = true, mov = true, m4v = true, webm = true, mkv = true, png = true, jpg = true, jpeg = true, webp = true, wav = true, mp3 = true, m4a = true, aac = true }
local function valid_file(name)
  if type(name) ~= "string" or #name < 3 or #name > 90 or string.find(name, "%.%.") then return false end
  local base, ext = string.match(name, "^([%w][%w_%-]*)%.(%w+)$")
  return base ~= nil and MEDIA_EXT[string.lower(ext)] == true
end
local function valid_out(name)
  return type(name) == "string" and #name >= 1 and #name <= 81 and string.find(name, "^[%w][%w_%-]*$") ~= nil
end
local function valid_name(name)
  return type(name) == "string" and #name >= 1 and #name <= 80 and string.find(name, "^[%w][%w _%-]*$") ~= nil
end
local function valid_hex(h) return type(h) == "string" and string.find(h, "^#%x%x%x%x%x%x$") ~= nil end

local function check_keys(args, allowed)
  local set = {}
  for _, k in ipairs(allowed) do set[k] = true end
  for k, _ in pairs(args) do
    if k ~= "__array" and not set[k] then fail("campo não permitido: " .. tostring(k)) end
  end
end

local function check_keyframes(list, name, min, max, max_frame)
  if list == nil then return end
  if type(list) ~= "table" or #list == 0 or #list > 64 then fail(name .. " inválido") end
  local last = -1
  for _, kf in ipairs(list) do
    if type(kf) ~= "table" or not is_int(kf.f, 0, max_frame) or kf.f <= last or not is_num(kf.v, min, max) then fail(name .. " fora do limite") end
    last = kf.f
  end
end

local function job_file(job_id, file_name)
  if not valid_job(job_id) or not valid_file(file_name) then fail("arquivo inválido") end
  return root_path("jobs", job_id, file_name)
end

---------------------------------------------------------------------------
-- Estado da sessão
---------------------------------------------------------------------------
local state = { project = nil, timeline = nil, media = {}, items = {}, renderJobId = nil, stop = false }

local function need_project()
  if not state.project then fail("nenhum projeto criado nesta sessão") end
  return state.project
end
local function need_timeline()
  if not state.timeline then fail("nenhuma timeline criada nesta sessão") end
  return state.timeline
end
local function need_item(ref)
  if not valid_ref(ref) then fail("referência inválida") end
  local item = state.items[ref]
  if not item then fail("clipe não encontrado: " .. ref) end
  return item
end

---------------------------------------------------------------------------
-- Fusion
---------------------------------------------------------------------------
local function get_comp(item)
  local comp = nil
  if item:GetFusionCompCount() > 0 then comp = item:GetFusionCompByIndex(1) end
  if not comp then comp = item:AddFusionComp() end
  if not comp then fail("não foi possível criar a composição Fusion do clipe") end
  return comp
end

local function comp_offset(comp)
  local attrs = comp:GetAttrs() or {}
  return attrs.COMPN_GlobalStart or attrs.COMPN_RenderStart or 0
end

local function animate(comp, tool, input_name, keyframes, offset, map)
  if not keyframes or #keyframes == 0 then return end
  if #keyframes == 1 then
    local v = keyframes[1].v
    tool[input_name] = map and map(v) or v
    return
  end
  tool[input_name] = comp:BezierSpline({})
  for _, kf in ipairs(keyframes) do
    local v = kf.v
    tool[input_name][offset + kf.f] = map and map(v) or v
  end
end

--- Anima um ponto (Center) com XYPath; X e Y animados separadamente.
local function animate_point(comp, tool, input_name, kx, ky, offset)
  if (not kx or #kx == 0) and (not ky or #ky == 0) then return end
  tool[input_name] = comp:XYPath({})
  local output = tool[input_name]:GetConnectedOutput()
  local path = output and output:GetTool()
  if not path then fail("XYPath indisponível") end
  if kx and #kx > 0 then animate(comp, path, "X", kx, offset) else path.X = 0.5 end
  if ky and #ky > 0 then animate(comp, path, "Y", ky, offset) else path.Y = 0.5 end
end

local function hex_rgb(hex)
  return tonumber(string.sub(hex, 2, 3), 16) / 255, tonumber(string.sub(hex, 4, 5), 16) / 255, tonumber(string.sub(hex, 6, 7), 16) / 255
end

local function timeline_size()
  local project = need_project()
  return tonumber(project:GetSetting("timelineResolutionWidth")) or 1080, tonumber(project:GetSetting("timelineResolutionHeight")) or 1920
end

---------------------------------------------------------------------------
-- Operações
---------------------------------------------------------------------------
local OPS = {}

OPS.ping = function(args)
  check_keys(args, {})
  local version = resolveApp and resolveApp:GetVersionString() or "?"
  local product = resolveApp and resolveApp:GetProductName() or "?"
  return { bridge = BRIDGE_VERSION, protocol = PROTOCOL, product = product, version = version }
end

OPS.create_project = function(args)
  check_keys(args, { "name", "width", "height", "fps" })
  if not valid_name(args.name) then fail("nome inválido") end
  if not is_int(args.width, 16, 3840) or not is_int(args.height, 16, 3840) or not is_int(args.fps, 1, 60) then fail("formato inválido") end
  local pm = resolveApp:GetProjectManager()
  local project = pm:CreateProject(args.name)
  if not project then fail("o DaVinci recusou criar o projeto (nome repetido?)") end
  state.project, state.timeline, state.media, state.items, state.renderJobId = project, nil, {}, {}, nil
  local settings = {
    timelineResolutionWidth = tostring(args.width),
    timelineResolutionHeight = tostring(args.height),
    timelineOutputResolutionWidth = tostring(args.width),
    timelineOutputResolutionHeight = tostring(args.height),
    timelineFrameRate = tostring(args.fps),
    timelinePlaybackFrameRate = tostring(args.fps),
    timelineInputResMismatchBehavior = "scaleToFit",
  }
  local applied = {}
  for k, v in pairs(settings) do applied[k] = project:SetSetting(k, v) and true or false end
  return { applied = applied }
end

OPS.import_media = function(args)
  check_keys(args, { "jobId", "files" })
  if type(args.files) ~= "table" or #args.files == 0 or #args.files > 120 then fail("lista de arquivos inválida") end
  local project = need_project()
  local pool = project:GetMediaPool()
  local imported = {}
  -- Um arquivo por chamada: evita que o Resolve agrupe imagens numeradas como sequência.
  for _, name in ipairs(args.files) do
    local path = job_file(args.jobId, name)
    local result = pool:ImportMedia({ path })
    local item = result and result[1]
    if not item then fail("falha ao importar " .. name) end
    state.media[name] = item
    imported[#imported + 1] = name
  end
  imported.__array = true
  return { imported = imported }
end

OPS.create_timeline = function(args)
  check_keys(args, { "name" })
  if not valid_name(args.name) then fail("nome inválido") end
  local project = need_project()
  local timeline = project:GetMediaPool():CreateEmptyTimeline(args.name)
  if not timeline then fail("falha ao criar timeline") end
  project:SetCurrentTimeline(timeline)
  state.timeline = timeline
  return { startFrame = timeline:GetStartFrame() }
end

OPS.add_track = function(args)
  check_keys(args, { "type" })
  local timeline = need_timeline()
  local ok
  if args.type == "video" then ok = timeline:AddTrack("video")
  elseif args.type == "audio" then ok = timeline:AddTrack("audio", "stereo")
  else fail("tipo inválido") end
  return { ok = ok and true or false, video = timeline:GetTrackCount("video"), audio = timeline:GetTrackCount("audio") }
end

OPS.append_clip = function(args)
  check_keys(args, { "ref", "jobId", "fileName", "startFrame", "endFrame", "trackIndex", "recordFrame", "mediaType" })
  if not valid_ref(args.ref) or not valid_job(args.jobId) or not valid_file(args.fileName) then fail("referência inválida") end
  if not is_int(args.startFrame, 0, 10000000) or not is_int(args.endFrame, 0, 10000000) or args.endFrame <= args.startFrame then fail("quadros inválidos") end
  if not is_int(args.trackIndex, 1, 8) or not is_int(args.recordFrame, 0, 1000000) or (args.mediaType ~= 1 and args.mediaType ~= 2) then fail("posição inválida") end
  local project = need_project()
  local timeline = need_timeline()
  local media = state.media[args.fileName]
  if not media then fail("mídia não importada: " .. args.fileName) end
  local info = {
    mediaPoolItem = media,
    startFrame = args.startFrame,
    endFrame = args.endFrame,
    trackIndex = args.trackIndex,
    recordFrame = timeline:GetStartFrame() + args.recordFrame,
    mediaType = args.mediaType,
  }
  local items = project:GetMediaPool():AppendToTimeline({ info })
  local item = items and items[1]
  if not item then fail("o DaVinci não adicionou o clipe " .. args.ref) end
  state.items[args.ref] = item
  return { start = item:GetStart() - timeline:GetStartFrame(), duration = item:GetDuration() }
end

local PROP_LIMITS = { ZoomX = { 0.1, 10 }, ZoomY = { 0.1, 10 }, Pan = { -8000, 8000 }, Tilt = { -8000, 8000 }, Opacity = { 0, 100 } }

OPS.set_clip_properties = function(args)
  check_keys(args, { "ref", "props" })
  local item = need_item(args.ref)
  if type(args.props) ~= "table" then fail("propriedades inválidas") end
  local applied = {}
  for k, v in pairs(args.props) do
    local lim = PROP_LIMITS[k]
    if not lim then fail("propriedade não permitida: " .. tostring(k)) end
    if not is_num(v, lim[1], lim[2]) then fail(k .. " fora do limite") end
    applied[k] = item:SetProperty(k, v) and true or false
  end
  return { applied = applied }
end

OPS.style_clip = function(args)
  check_keys(args, { "ref", "durationFrames", "size", "centerX", "centerY", "alpha", "dip" })
  local item = need_item(args.ref)
  if not is_int(args.durationFrames, 1, 1000000) then fail("duração inválida") end
  local max = args.durationFrames
  check_keyframes(args.size, "size", 0.2, 4, max)
  check_keyframes(args.centerX, "centerX", -1.5, 2.5, max)
  check_keyframes(args.centerY, "centerY", -1.5, 2.5, max)
  check_keyframes(args.alpha, "alpha", 0, 1, max)
  check_keyframes(args.dip, "dip", 0, 1, max)

  local comp = get_comp(item)
  comp:Lock()
  local ok, err = pcall(function()
    local offset = comp_offset(comp)
    local media_in = comp:FindTool("MediaIn1")
    local media_out = comp:FindTool("MediaOut1")
    if not media_in or not media_out then fail("composição sem MediaIn/MediaOut") end
    local last = media_in
    if args.size or args.centerX or args.centerY then
      local xf = comp:AddTool("Transform")
      xf:ConnectInput("Input", last)
      animate(comp, xf, "Size", args.size, offset)
      animate_point(comp, xf, "Center", args.centerX, args.centerY, offset)
      last = xf
    end
    if args.dip then
      local dip = comp:AddTool("BrightnessContrast")
      dip:ConnectInput("Input", last)
      dip.ProcessAlpha = 0
      animate(comp, dip, "Gain", args.dip, offset, function(v) return 1 - v end)
      last = dip
    end
    if args.alpha then
      local fade = comp:AddTool("BrightnessContrast")
      fade:ConnectInput("Input", last)
      fade.ProcessAlpha = 1
      animate(comp, fade, "Gain", args.alpha, offset)
      last = fade
    end
    media_out:ConnectInput("Input", last)
  end)
  comp:Unlock()
  if not ok then error(err, 0) end
  return { offset = comp_offset(comp) }
end

OPS.build_text_layer = function(args)
  check_keys(args, { "ref", "durationFrames", "layers" })
  local item = need_item(args.ref)
  if not is_int(args.durationFrames, 1, 1000000) then fail("duração inválida") end
  if type(args.layers) ~= "table" or #args.layers == 0 or #args.layers > 80 then fail("camadas inválidas") end
  local max = args.durationFrames
  for _, layer in ipairs(args.layers) do
    check_keys(layer, { "text", "size", "colorHex", "bandHex", "bold", "fontFamily", "x", "y", "bandHeight", "alpha", "dy", "scale" })
    if type(layer.text) ~= "string" or #layer.text == 0 or #layer.text > 400 then fail("texto inválido") end
    if not is_num(layer.size, 0.01, 0.2) or not valid_hex(layer.colorHex) or (layer.bandHex ~= nil and not valid_hex(layer.bandHex)) then fail("estilo inválido") end
    if type(layer.bold) ~= "boolean" or type(layer.fontFamily) ~= "string" or not string.find(layer.fontFamily, "^[%w %._%-]+$") then fail("fonte inválida") end
    if not is_num(layer.x, 0, 1) or not is_num(layer.y, 0, 1) or not is_num(layer.bandHeight, 0, 1) then fail("posição inválida") end
    check_keyframes(layer.alpha, "alpha", 0, 1, max)
    if not layer.alpha then fail("texto sem janela de tempo") end
    check_keyframes(layer.dy, "dy", -0.5, 0.5, max)
    check_keyframes(layer.scale, "scale", 0.2, 3, max)
  end

  local width, height = timeline_size()
  local comp = get_comp(item)
  comp:Lock()
  local ok, err = pcall(function()
    local offset = comp_offset(comp)
    local media_in = comp:FindTool("MediaIn1")
    local media_out = comp:FindTool("MediaOut1")
    if not media_in or not media_out then fail("composição sem MediaIn/MediaOut") end
    local last = media_in
    for _, layer in ipairs(args.layers) do
      if layer.bandHex then
        local band = comp:AddTool("Background")
        band.Width, band.Height = width, height
        local r, g, b = hex_rgb(layer.bandHex)
        band.TopLeftRed, band.TopLeftGreen, band.TopLeftBlue, band.TopLeftAlpha = r * 0.82, g * 0.82, b * 0.82, 0.82
        local mask = comp:AddTool("RectangleMask")
        mask.Center = { 0.5, layer.y }
        mask.Width = 1.0
        mask.Height = layer.bandHeight * height / width
        mask.SoftEdge = 0.004
        band:ConnectInput("EffectMask", mask)
        local band_merge = comp:AddTool("Merge")
        band_merge:ConnectInput("Background", last)
        band_merge:ConnectInput("Foreground", band)
        animate(comp, band_merge, "Blend", layer.alpha, offset)
        last = band_merge
      end
      local text = comp:AddTool("TextPlus")
      text.Width, text.Height = width, height
      text.StyledText = layer.text
      text.Font = layer.fontFamily
      text.Style = layer.bold and "Bold" or "Regular"
      text.Size = layer.size * TEXT_SIZE_FACTOR
      text.Center = { layer.x, layer.y }
      local r, g, b = hex_rgb(layer.colorHex)
      text.Red1, text.Green1, text.Blue1 = r, g, b
      local source = text
      if layer.dy or layer.scale then
        local xf = comp:AddTool("Transform")
        xf:ConnectInput("Input", text)
        if layer.scale then
          animate(comp, xf, "Size", layer.scale, offset)
          xf.Pivot = { layer.x, layer.y }
        end
        if layer.dy then
          local ky = {}
          for i, kf in ipairs(layer.dy) do ky[i] = { f = kf.f, v = 0.5 + kf.v } end
          animate_point(comp, xf, "Center", nil, ky, offset)
        end
        source = xf
      end
      local merge = comp:AddTool("Merge")
      merge:ConnectInput("Background", last)
      merge:ConnectInput("Foreground", source)
      animate(comp, merge, "Blend", layer.alpha, offset)
      last = merge
    end
    media_out:ConnectInput("Input", last)
  end)
  comp:Unlock()
  if not ok then error(err, 0) end
  return { layers = #args.layers }
end

local function pick_h264(project)
  local codecs = project:GetRenderCodecs("mp4") or {}
  local preferred = nil
  for description, codec in pairs(codecs) do
    local key = string.upper(tostring(codec))
    if key == "H264" then return codec, description end
    if not preferred and string.find(key, "^H264") then preferred = { codec, description } end
  end
  if preferred then return preferred[1], preferred[2] end
  return nil, nil
end

OPS.set_render = function(args)
  check_keys(args, { "jobId", "fileName", "width", "height", "fps" })
  if not valid_job(args.jobId) or not valid_out(args.fileName) then fail("destino inválido") end
  if not is_int(args.width, 16, 3840) or not is_int(args.height, 16, 3840) or not is_int(args.fps, 1, 60) then fail("formato inválido") end
  local project = need_project()
  need_timeline()
  local codec, description = pick_h264(project)
  if not codec then fail("nenhum codec H.264 disponível para MP4 nesta instalação do DaVinci") end
  if not project:SetCurrentRenderFormatAndCodec("mp4", codec) then fail("o DaVinci recusou MP4/" .. tostring(codec)) end
  local settings = {
    SelectAllFrames = true,
    TargetDir = root_path("jobs", args.jobId, "output"),
    CustomName = args.fileName,
    FormatWidth = args.width,
    FormatHeight = args.height,
    FrameRate = args.fps,
    ExportVideo = true,
    ExportAudio = true,
  }
  if not project:SetRenderSettings(settings) then fail("o DaVinci recusou as configurações de render") end
  project:DeleteAllRenderJobs()
  local job = project:AddRenderJob()
  if not job then fail("o DaVinci não criou o job de render") end
  state.renderJobId = job
  return { renderJobId = job, codec = codec, codecDescription = description }
end

OPS.start_render = function(args)
  check_keys(args, {})
  local project = need_project()
  if not state.renderJobId then fail("render não configurado") end
  local ok = project:StartRendering({ state.renderJobId }, false)
  if not ok then ok = project:StartRendering(state.renderJobId) end
  if not ok then fail("o DaVinci não iniciou o render") end
  return { renderJobId = state.renderJobId }
end

OPS.render_status = function(args)
  check_keys(args, { "renderJobId" })
  local project = need_project()
  if args.renderJobId ~= state.renderJobId then fail("job de render desconhecido") end
  local status = project:GetRenderJobStatus(state.renderJobId) or {}
  return {
    status = status.JobStatus or "?",
    percent = status.CompletionPercentage or 0,
    error = status.Error,
    rendering = project:IsRenderingInProgress() and true or false,
    timeTakenMs = status.TimeTakenToRenderInMs,
  }
end

OPS.stop_render = function(args)
  check_keys(args, {})
  local project = need_project()
  project:StopRendering()
  return { stopped = true }
end

OPS.save_project = function(args)
  check_keys(args, {})
  need_project()
  return { saved = resolveApp:GetProjectManager():SaveProject() and true or false }
end

OPS.close_project = function(args)
  check_keys(args, {})
  local project = need_project()
  local pm = resolveApp:GetProjectManager()
  pm:SaveProject()
  local closed = pm:CloseProject(project) and true or false
  state.project, state.timeline, state.media, state.items, state.renderJobId = nil, nil, {}, {}, nil
  return { closed = closed }
end

OPS.stop_bridge = function(args)
  check_keys(args, {})
  state.stop = true
  return { stopping = true }
end

---------------------------------------------------------------------------
-- Despacho
---------------------------------------------------------------------------
local function handle(raw)
  local ok, request = pcall(json.decode, raw)
  if not ok or type(request) ~= "table" then return nil, { v = PROTOCOL, id = "?", ok = false, error = "pedido ilegível" } end
  local id = request.id
  if type(id) ~= "string" or not string.find(id, "^[%w%-]+$") or #id > 64 then return nil, { v = PROTOCOL, id = "?", ok = false, error = "id inválido" } end
  if request.v ~= PROTOCOL then return id, { v = PROTOCOL, id = id, ok = false, error = "versão de protocolo incompatível" } end
  local fn = type(request.op) == "string" and OPS[request.op]
  if not fn then return id, { v = PROTOCOL, id = id, ok = false, error = "operação não permitida" } end
  local args = request.args
  if args == nil then args = {} end
  if type(args) ~= "table" then return id, { v = PROTOCOL, id = id, ok = false, error = "argumentos inválidos" } end
  local success, result = pcall(fn, args)
  if success then return id, { v = PROTOCOL, id = id, ok = true, result = result } end
  local message = type(result) == "table" and result.message or tostring(result)
  return id, { v = PROTOCOL, id = id, ok = false, error = message }
end

-- Exposto para testes fora do Resolve (LuaJIT): `VorixBridge = dofile(...)` não é usado aqui.
local M = { json = json, handle = handle, OPS = OPS, state = state, _valid_file = valid_file, _valid_job = valid_job }

local function sleep(seconds)
  if bmd and bmd.wait then bmd.wait(seconds) return end
  local start = os.clock()
  while os.clock() - start < seconds do end
end

local function run()
  if not io or not io.open then
    print("[VorixBridge] Este build do DaVinci não oferece leitura de arquivos ao Lua (io). A ponte não pode rodar; registre a versão e avise a equipe.")
    return
  end
  if not resolveApp then
    print("[VorixBridge] API do Resolve indisponível neste contexto.")
    return
  end
  local request_path = root_path("inbox", "request.json")
  local response_path = root_path("outbox", "response.json")
  local status_path = root_path("status.json")
  local caps = { io = true, os_rename = (os and os.rename) and true or false, bmd_wait = (bmd and bmd.wait) and true or false }
  print("[VorixBridge] " .. BRIDGE_VERSION .. " ativa em " .. BRIDGE_ROOT .. " — " .. tostring(resolveApp:GetProductName()) .. " " .. tostring(resolveApp:GetVersionString()))
  local last_id = nil
  local polls = 0
  local beat = 0
  while not state.stop do
    polls = polls + 1
    if polls % BEAT_EVERY == 1 then
      beat = beat + 1
      write_file(status_path, json.encode({ state = "ready", beat = beat, bridge = BRIDGE_VERSION, protocol = PROTOCOL, caps = caps, busy = false }))
    end
    local raw = read_file(request_path)
    if raw and #raw > 0 then
      local peek_ok, peek = pcall(json.decode, raw)
      local peek_id = peek_ok and type(peek) == "table" and peek.id or nil
      if peek_id ~= last_id then
        local id, response = handle(raw)
        last_id = id or peek_id
        write_file(response_path, json.encode(response))
      end
    end
    sleep(POLL_SECONDS)
  end
  write_file(status_path, json.encode({ state = "stopped", beat = beat + 1, bridge = BRIDGE_VERSION, protocol = PROTOCOL }))
  print("[VorixBridge] encerrada.")
end

if VORIX_BRIDGE_TEST_MODE then
  return M
end
run()
