-- Executa pedidos JSON (um por linha, de um arquivo) pelo `handle` da ponte com o Resolve simulado.
-- Uso: luajit run-bridge.lua <resolve-mock.lua> <VorixBridge.lua> <requests.jsonl>
local mock_path, bridge_path, requests_path = arg[1], arg[2], arg[3]
dofile(mock_path)
VORIX_BRIDGE_TEST_MODE = true
local bridge = dofile(bridge_path)
local out = {}
for line in io.lines(requests_path) do
  if #line > 0 then
    local _, response = bridge.handle(line)
    out[#out + 1] = bridge.json.encode(response)
  end
end
for _, call in ipairs(CALLS) do out[#out + 1] = bridge.json.encode({ call = call }) end
io.write(table.concat(out, "\n"))
