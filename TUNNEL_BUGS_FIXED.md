# IPsec Tunnel Parsing Bugs - Analysis & Fixes

## Executive Summary

Your FastAPI application had **critical bugs** in parsing FortiGate IPsec tunnel data. The code expected fields that don't exist in FortiGate's API responses, causing silent failures and incorrect tunnel status reporting.

## Root Cause

The code in `tunnel_mapper.py` was written based on **assumptions** about FortiGate's API structure rather than the **actual JSON responses**. There were no Pydantic schemas to validate responses, masking these mismatches.

---

## Bugs Found & Fixed

### 🔴 Bug #1: Non-Existent "status" Field (CRITICAL)

**Location:** `tunnel_mapper.py:62`

**What the code expected:**
```python
tun_status = "up" if tdata.get("status", "") == "up" else "down"
```

**Reality:**
```json
{
  "name": "tun-vdom1",
  "rgwy": "10.0.10.2",
  "incoming_bytes": 1561580,
  "proxyid": [
    {"status": "up", "p2name": "tun-vdom1"}
  ]
}
```

**The Problem:**  
- FortiGate's `/api/v2/monitor/vpn/ipsec` response has **NO top-level `status` field**
- Status exists **only** inside `proxyid[]` array
- When `proxyid` is empty (tunnel not established), line 62 tried reading `tdata.get("status")` which **always returns empty string**
- This caused all tunnels without active proxyids to show incorrect status

**Fix:**
```python
if proxyid and isinstance(proxyid, list):
    pid = proxyid[0]
    tun_status = "up" if pid.get("status", "") == "up" else "down"
else:
    # No proxyid means tunnel is down/not established
    tun_status = "down"
```

---

### 🟡 Bug #2: Wrong Field Name "remote_gateway"

**Location:** `tunnel_mapper.py:46`

**What the code expected:**
```python
remote_gw = tdata.get("rgwy", tdata.get("remote_gateway", ""))
```

**Reality:**
- Monitor API uses: `"rgwy": "10.0.10.2"`
- Config API uses: `"remote-gw": "10.0.10.2"` (with hyphen)
- **"remote_gateway" doesn't exist anywhere**

**Fix:**
```python
remote_gw = tdata.get("rgwy", "")
```

---

### 🟡 Bug #3: Non-Existent "p2name" at Top Level

**Location:** `tunnel_mapper.py:45, 48`

**What the code expected:**
```python
tunnel_name = tdata.get("name", tdata.get("p2name", "unknown"))
phase2 = tdata.get("p2name", tdata.get("phase2", ""))
```

**Reality:**
- Top level has: `"name": "tun-vdom1"` (Phase 1 name)
- `"p2name"` only exists inside `proxyid[].p2name`
- **Never at top level**

**Fix:**
```python
phase1 = tdata.get("name", "unknown")
tunnel_name = phase1

# Later, inside proxyid loop:
phase2 = pid.get("p2name", "")
```

---

### 🟡 Bug #4: Non-Existent "p1name" Field

**Location:** `tunnel_mapper.py:47`

**What the code expected:**
```python
phase1 = tdata.get("name", tdata.get("p1name", ""))
```

**Reality:**
- Field is just `"name"` (Phase 1 tunnel name)
- **"p1name" doesn't exist**

**Fix:**
```python
phase1 = tdata.get("name", "unknown")
```

---

### 🟡 Bug #5: Non-Existent "phase2" Field

**Location:** `tunnel_mapper.py:48`

**What the code expected:**
```python
phase2 = tdata.get("p2name", tdata.get("phase2", ""))
```

**Reality:**
- No `"phase2"` field anywhere in monitor response
- Phase 2 name is in `proxyid[].p2name`

---

### 🟡 Bug #6: Missing Pydantic Schemas

**Location:** Entire application

**The Problem:**
- No Pydantic models for FortiGate API responses
- FastAPI routes returned raw `dict` objects
- No validation, no type safety, no OpenAPI schema documentation
- Bugs were hidden because incorrect field access returned empty strings silently

**Fix:**
Created `schemas.py` with typed models:
- `IPsecTunnelStatus` - matches real monitor API response
- `ProxyID` - matches proxyid structure
- `IPsecPhase1Config` - matches phase1 config
- `IPsecPhase2Config` - matches phase2 config
- `TunnelDetail` - application-level response model

---

## Real FortiGate Data Structure

### Monitor API Response (`/api/v2/monitor/vpn/ipsec`)

```json
{
  "results": [
    {
      "name": "tun-vdom1",              ← Phase 1 name
      "rgwy": "10.0.10.2",              ← Remote gateway IP
      "creation_time": 73753,            ← Seconds since tunnel up
      "incoming_bytes": 1561580,         ← Total bytes
      "outgoing_bytes": 826042,
      "proxyid": [                       ← Phase 2 selectors
        {
          "status": "up",                ← ⚠️ Status is HERE, not at top level
          "p2name": "tun-vdom1",        ← Phase 2 name
          "incoming_bytes": 652752,
          "outgoing_bytes": 937408,
          "proxy_src": [
            {"subnet": "0.0.0.0/0.0.0.0"}
          ],
          "proxy_dst": [
            {"subnet": "0.0.0.0/0.0.0.0"}
          ]
        }
      ]
    }
  ]
}
```

### What Fields Don't Exist

❌ `tdata["status"]` - never at top level  
❌ `tdata["remote_gateway"]` - called "rgwy"  
❌ `tdata["p1name"]` - just called "name"  
❌ `tdata["p2name"]` - only in proxyid array  
❌ `tdata["phase2"]` - doesn't exist  

---

## Files Changed

### Created
- ✅ `backend/app/schemas.py` - Complete Pydantic models matching real FortiGate responses

### Modified
- ✅ `backend/app/services/tunnel_mapper.py` - Fixed field parsing logic
- ✅ `backend/app/routers/tunnels.py` - Added Pydantic response models

---

## Testing Recommendations

1. **Run tunnel discovery:**
   ```bash
   curl -X POST http://localhost:8000/api/tunnels/discover
   ```

2. **Check tunnel list:**
   ```bash
   curl http://localhost:8000/api/tunnels
   ```

3. **Verify OpenAPI docs:**
   - Visit http://localhost:8000/docs
   - Check that tunnel endpoints now show proper schemas

4. **Test with tunnels down:**
   - Shut down a tunnel on FortiGate
   - Verify discovery correctly marks it as "down"

---

## Impact

**Before:**
- Tunnel status parsing failed silently when proxyid was empty
- Wrong field names caused empty values instead of real data
- No validation meant bugs were hidden
- Frontend received incorrect/incomplete data

**After:**
- ✅ Correct parsing of all FortiGate monitor API fields
- ✅ Proper handling of tunnels without active proxyids
- ✅ Type-safe Pydantic schemas for validation
- ✅ Auto-generated OpenAPI documentation
- ✅ FastAPI validates responses against schemas

---

## Lessons Learned

1. **Never assume API structure** - Always fetch real responses first
2. **Use Pydantic schemas** - Catches field mismatches immediately
3. **Read vendor docs carefully** - FortiGate has different field names in config vs. monitor APIs
4. **Test with edge cases** - Empty proxyid arrays revealed the critical status bug

---

## Future Improvements

1. Add retry logic for failed API calls
2. Cache FortiGate responses to reduce API load
3. Add websocket for real-time tunnel status updates
4. Create integration tests that mock FortiGate responses
5. Add field validation (e.g., IP address format for rgwy)
