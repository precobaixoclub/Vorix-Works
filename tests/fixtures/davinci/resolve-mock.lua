-- Resolve simulado para testar VorixBridge.lua fora do DaVinci (LuaJIT).
-- Registra chamadas em CALLS para o teste conferir o que a ponte faria na API real.

CALLS = {}
local function log(...) CALLS[#CALLS + 1] = table.concat({ ... }, " ") end

local function new_spline(name)
  local keys = {}
  local spline = { __kind = name, keys = keys }
  return setmetatable(spline, {
    __newindex = function(t, k, v)
      if type(k) == "number" then keys[#keys + 1] = { k, v } log("key", name, k, tostring(v)) else rawset(t, k, v) end
    end,
  })
end

local function new_tool(id)
  local inputs = {}
  local tool = { __id = id, inputs = inputs }
  function tool:ConnectInput(name, other) log("connect", id, name, other and other.__id or "nil") return true end
  function tool:GetConnectedOutput() return nil end
  return setmetatable(tool, {
    __index = function(_, k) return inputs[k] end,
    __newindex = function(_, k, v)
      if type(v) == "table" and v.__kind == "xypath" then
        local path = new_tool("XYPath")
        v.GetConnectedOutput = function() return { GetTool = function() return path end } end
      end
      inputs[k] = v
      log("set", id, k, type(v) == "table" and (v.__kind or "table") or tostring(v))
    end,
  })
end

local function new_comp()
  local tools = { MediaIn1 = new_tool("MediaIn1"), MediaOut1 = new_tool("MediaOut1") }
  local count = 0
  local comp = {}
  function comp:Lock() end
  function comp:Unlock() end
  function comp:GetAttrs() return { COMPN_GlobalStart = 0 } end
  function comp:FindTool(name) return tools[name] end
  function comp:AddTool(kind) count = count + 1 log("addtool", kind) local t = new_tool(kind .. count) return t end
  function comp:BezierSpline() return new_spline("bezier") end
  function comp:XYPath() return new_spline("xypath") end
  return comp
end

local function new_item(info)
  local comps = {}
  local item = {}
  function item:SetProperty(k, v) log("prop", k, tostring(v)) return true end
  function item:GetStart() return info.recordFrame end
  function item:GetDuration() return info.endFrame - info.startFrame + 1 end
  function item:GetFusionCompCount() return #comps end
  function item:GetFusionCompByIndex(i) return comps[i] end
  function item:AddFusionComp() local c = new_comp() comps[#comps + 1] = c return c end
  return item
end

local timeline = { tracks = { video = 1, audio = 1 } }
function timeline:GetStartFrame() return 108000 end
function timeline:AddTrack(kind) self.tracks[kind] = self.tracks[kind] + 1 log("addtrack", kind) return true end
function timeline:GetTrackCount(kind) return self.tracks[kind] end

local pool = {}
function pool:ImportMedia(paths) log("import", paths[1]) return { { path = paths[1] } } end
function pool:CreateEmptyTimeline(name) log("timeline", name) return timeline end
function pool:AppendToTimeline(list)
  local info = list[1]
  log("append", info.mediaPoolItem.path, info.startFrame, info.endFrame, info.trackIndex, info.recordFrame, info.mediaType)
  return { new_item(info) }
end

local settings = {}
local project = {}
function project:SetSetting(k, v) settings[k] = v log("setting", k, v) return true end
function project:GetSetting(k) return settings[k] end
function project:GetMediaPool() return pool end
function project:SetCurrentTimeline() return true end
function project:GetRenderCodecs(format) return { ["H.264"] = "H264", ["H.265"] = "H265" } end
function project:SetCurrentRenderFormatAndCodec(f, c) log("format", f, c) return true end
function project:SetRenderSettings(s) log("render-settings", s.TargetDir, s.CustomName, s.FormatWidth, s.FormatHeight) return true end
function project:DeleteAllRenderJobs() return true end
function project:AddRenderJob() return "render-job-1" end
function project:StartRendering(...) log("start-render") return true end
function project:GetRenderJobStatus() return { JobStatus = "Complete", CompletionPercentage = 100 } end
function project:IsRenderingInProgress() return false end
function project:StopRendering() log("stop-render") end

local pm = {}
local existing = {}
function pm:CreateProject(name) if existing[name] then return nil end existing[name] = true log("project", name) return project end
function pm:SaveProject() return true end
function pm:CloseProject() return true end

resolve = {}
function resolve:GetProjectManager() return pm end
function resolve:GetVersionString() return "21.1.2.10" end
function resolve:GetProductName() return "DaVinci Resolve" end
