# Newapi CLI Auth And Token Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本计划不包含 git 提交步骤；每个任务完成后运行验证，提交仅在用户明确要求后执行。

**Goal:** 为 Claude360 Copilot 补齐 newapi CLI 用户名密码登录、2FA 登录和 token 用量统计接口。

**Architecture:** 在现有 `/api/cli/*` 聚合接口中扩展，不新增独立认证体系。密码登录复用 `model.User.ValidateAndFill`、`model.IsTwoFAEnabled` 和 `ensureUserAccessToken`；2FA 使用短生命周期 challenge，避免依赖浏览器 session；token stats 复用 `model.GetUserTokenStats` 并走 `middleware.CliAccessTokenAuth()`。

**Tech Stack:** Go 1.25.1、Gin、GORM、newapi controller/router、Go test。

---

## File Structure

- Modify: `newapi/router/api-router.go`
  - 在 `/api/cli` 下增加 `POST /auth/password`、`POST /auth/password/2fa`。
  - 在 `cliAuthed` 下增加 `GET /token_stats`。

- Modify: `newapi/controller/cli.go`
  - 增加 CLI password login request/response 类型。
  - 增加短生命周期 2FA challenge store。
  - 增加 `CliAuthPassword`、`CliAuthPassword2FA`、`CliTokenStats`。
  - 抽出 `buildCliLoginSuccessResponse(userId int)` 一类 helper，复用 `ensureUserAccessToken`。

- Modify: `newapi/controller/cli_test.go`
  - 增加 challenge 生成、过期、一次性消费、格式化 stats 参数的单元测试。

- Create: `newapi/controller/cli_password_auth_http_test.go`
  - 覆盖无 2FA 登录、2FA required、challenge 过期、错误验证码、成功换取 `cli_token`。

- Create: `newapi/controller/cli_token_stats_http_test.go`
  - 覆盖未登录拒绝、合法 `cli_token` 返回当前用户 token stats、时间参数默认值。

- Modify: `newapi/router/api_router_cli_auth_test.go`
  - 覆盖新路由的限流和鉴权位置：password 登录走公开 CLI 路由，token stats 走 `CliAccessTokenAuth()`。

## API Contract

### POST `/api/cli/auth/password`

Request:

```json
{
  "username": "user@example.com",
  "password": "secret"
}
```

Response when no 2FA:

```json
{
  "success": true,
  "data": {
    "require_2fa": false,
    "cli_token": "access-token",
    "user": {
      "id": 1,
      "username": "demo",
      "display_name": "Demo",
      "group": "default"
    }
  }
}
```

Response when 2FA required:

```json
{
  "success": true,
  "data": {
    "require_2fa": true,
    "challenge_id": "short-lived-id",
    "expires_in": 300
  }
}
```

### POST `/api/cli/auth/password/2fa`

Request:

```json
{
  "challenge_id": "short-lived-id",
  "code": "123456"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "require_2fa": false,
    "cli_token": "access-token",
    "user": {
      "id": 1,
      "username": "demo",
      "display_name": "Demo",
      "group": "default"
    }
  }
}
```

### GET `/api/cli/token_stats`

Headers:

```http
Authorization: Bearer <cli_token>
```

Query:

- `start_timestamp`：可选，秒级时间戳；默认近 30 天。
- `end_timestamp`：可选，秒级时间戳；默认当前时间。

Response:

```json
{
  "success": true,
  "data": [
    {
      "name": "Claude360 Copilot / text",
      "token_id": 12,
      "quota": 1234,
      "prompt_tokens": 1000,
      "completion_tokens": 200,
      "request_count": 20
    }
  ]
}
```

实际字段以 `model.GetUserTokenStats` 返回结构为准，controller 不重新定义业务统计口径。

## Task 1: 路由契约测试

**Files:**

- Modify: `newapi/router/api_router_cli_auth_test.go`
- Reference: `newapi/router/api-router.go`

- [x] **Step 1: 写失败测试，断言 password 路由存在**

在 `TestCliAuthRouteRateLimits` 中增加检查：

```go
if !strings.Contains(source, `cliRoute.POST("/auth/password", middleware.CriticalRateLimit(), middleware.TurnstileCheck(), controller.CliAuthPassword)`) {
    t.Fatal("未找到 /api/cli/auth/password 路由或中间件顺序错误")
}
if !strings.Contains(source, `cliRoute.POST("/auth/password/2fa", middleware.CriticalRateLimit(), controller.CliAuthPassword2FA)`) {
    t.Fatal("未找到 /api/cli/auth/password/2fa 路由或中间件顺序错误")
}
```

- [x] **Step 2: 写失败测试，断言 token stats 走 CLI token 鉴权**

在同一测试中检查 `cliAuthed.GET("/token_stats", controller.CliTokenStats)` 出现在 `cliAuthed.Use(middleware.CliAccessTokenAuth())` 的作用域内。

- [x] **Step 3: 运行失败测试**

Run:

```bash
cd "newapi"
go test ./router -run TestCliAuthRouteRateLimits -v
```

Expected: FAIL，提示缺少新路由。

- [x] **Step 4: 增加路由**

在 `newapi/router/api-router.go` 的 CLI routes 中添加：

```go
cliRoute.POST("/auth/password", middleware.CriticalRateLimit(), middleware.TurnstileCheck(), controller.CliAuthPassword)
cliRoute.POST("/auth/password/2fa", middleware.CriticalRateLimit(), controller.CliAuthPassword2FA)
```

在 `cliAuthed` 中添加：

```go
cliAuthed.GET("/token_stats", controller.CliTokenStats)
```

- [x] **Step 5: 运行测试**

Run:

```bash
cd "newapi"
go test ./router -run TestCliAuthRouteRateLimits -v
```

Expected: PASS。

## Task 2: CLI password login helper 与无 2FA 登录

**Files:**

- Modify: `newapi/controller/cli.go`
- Create: `newapi/controller/cli_password_auth_http_test.go`
- Reference: `newapi/controller/user.go`

- [x] **Step 1: 写无 2FA 登录测试**

测试准备：

- 初始化内存 SQLite。
- 创建启用用户，密码使用当前 `model.User` 期望的 hash 写入方式。
- 路由挂载 `POST /api/cli/auth/password`。

断言：

- 正确用户名密码返回 `success=true`。
- `data.require_2fa=false`。
- `data.cli_token` 非空。
- 用户 `access_token` 被写入数据库。
- 响应不设置浏览器 session 依赖字段。

- [x] **Step 2: 运行失败测试**

Run:

```bash
cd "newapi"
go test ./controller -run TestCliAuthPasswordLoginWithoutTwoFA -v
```

Expected: FAIL，`CliAuthPassword` 未定义或未实现。

- [x] **Step 3: 添加 request/response 类型和成功响应 helper**

在 `newapi/controller/cli.go` 增加：

```go
type cliAuthPasswordRequest struct {
    Username string `json:"username"`
    Password string `json:"password"`
}

func buildCliLoginSuccessResponse(userId int) (gin.H, error) {
    token, err := ensureUserAccessToken(userId)
    if err != nil {
        return nil, err
    }
    user, err := model.GetUserById(userId, false)
    if err != nil {
        return nil, err
    }
    return gin.H{
        "require_2fa": false,
        "cli_token": token,
        "user": gin.H{
            "id": user.Id,
            "username": user.Username,
            "display_name": user.DisplayName,
            "group": user.Group,
        },
    }, nil
}
```

- [x] **Step 4: 实现 `CliAuthPassword` 最小版本**

逻辑：

1. 检查 `common.PasswordLoginEnabled`。
2. 解析 JSON。
3. 校验 username/password 非空。
4. 调 `model.User{Username, Password}.ValidateAndFill()`。
5. 如果用户启用 2FA，先返回未实现错误或进入下一任务的 challenge 分支。
6. 否则调用 `buildCliLoginSuccessResponse`。

- [x] **Step 5: 运行测试**

Run:

```bash
cd "newapi"
go test ./controller -run TestCliAuthPasswordLoginWithoutTwoFA -v
```

Expected: PASS。

## Task 3: CLI 2FA challenge store

**Files:**

- Modify: `newapi/controller/cli.go`
- Modify: `newapi/controller/cli_test.go`

- [x] **Step 1: 写 challenge 单元测试**

覆盖：

- 创建 challenge 后可按 `challenge_id` 找到 `user_id`。
- challenge 过期后不可使用。
- challenge 成功消费后第二次使用返回不存在。
- cleanup 会删除过期 challenge。

- [x] **Step 2: 运行失败测试**

Run:

```bash
cd "newapi"
go test ./controller -run TestCliPasswordTwoFAChallenge -v
```

Expected: FAIL，challenge helper 未定义。

- [x] **Step 3: 实现 challenge store**

在 `newapi/controller/cli.go` 增加：

```go
const cliPasswordTwoFAChallengeTTL = 5 * time.Minute

type cliPasswordTwoFAChallenge struct {
    ChallengeId string
    UserId int
    CreatedAt time.Time
    ExpiresAt time.Time
}
```

使用 `sync.Mutex` 和 `map[string]*cliPasswordTwoFAChallenge`，模式与 `cliAuthSessions` 保持一致。

- [x] **Step 4: 实现 helper**

需要 helper：

- `createCliPasswordTwoFAChallenge(userId int) (*cliPasswordTwoFAChallenge, error)`
- `consumeCliPasswordTwoFAChallenge(challengeId string) (int, bool)`
- `cleanupCliPasswordTwoFAChallengesLocked(now time.Time)`

- [x] **Step 5: 运行测试**

Run:

```bash
cd "newapi"
go test ./controller -run TestCliPasswordTwoFAChallenge -v
```

Expected: PASS。

## Task 4: CLI 2FA 登录接口

**Files:**

- Modify: `newapi/controller/cli.go`
- Modify: `newapi/controller/cli_password_auth_http_test.go`
- Reference: `newapi/controller/twofa.go`

- [x] **Step 1: 写 2FA required 测试**

断言：

- 用户密码正确且启用 2FA 时，`POST /api/cli/auth/password` 返回 `require_2fa=true`。
- 响应包含 `challenge_id` 和 `expires_in`。
- 响应不包含 `cli_token`。

- [x] **Step 2: 写 2FA 验证测试**

断言：

- 错误 `challenge_id` 返回 `success=false`。
- 错误验证码返回 `success=false`，challenge 不应被消费，允许用户重试。
- 正确 TOTP 或备用码返回 `cli_token`。
- 成功后 challenge 被消费，不能重复换 token。

- [x] **Step 3: 运行失败测试**

Run:

```bash
cd "newapi"
go test ./controller -run 'TestCliAuthPasswordLoginRequiresTwoFA|TestCliAuthPasswordTwoFA' -v
```

Expected: FAIL，2FA 分支未实现。

- [x] **Step 4: 修改 `CliAuthPassword` 的 2FA 分支**

启用 2FA 时：

```go
challenge, err := createCliPasswordTwoFAChallenge(user.Id)
if err != nil {
    common.ApiError(c, err)
    return
}
common.ApiSuccess(c, gin.H{
    "require_2fa": true,
    "challenge_id": challenge.ChallengeId,
    "expires_in": int(time.Until(challenge.ExpiresAt).Seconds()),
})
```

- [x] **Step 5: 实现 `CliAuthPassword2FA`**

逻辑：

1. 解析 `{ challenge_id, code }`。
2. 读取 challenge，但验证码错误时不要消费；成功后再消费。
3. 通过 `model.GetTwoFAByUserId` 读取 2FA 记录。
4. 复用 `common.ValidateNumericCode`、`twoFA.ValidateTOTPAndUpdateUsage`、`twoFA.ValidateBackupCodeAndUpdateUsage`。
5. 验证成功后调用 `buildCliLoginSuccessResponse(userId)`。

- [x] **Step 6: 运行测试**

Run:

```bash
cd "newapi"
go test ./controller -run 'TestCliAuthPasswordLoginRequiresTwoFA|TestCliAuthPasswordTwoFA' -v
```

Expected: PASS。

## Task 5: CLI token stats 接口

**Files:**

- Modify: `newapi/controller/cli.go`
- Create: `newapi/controller/cli_token_stats_http_test.go`
- Reference: `newapi/controller/log.go`
- Reference: `newapi/model/log.go` 或 `model.GetUserTokenStats` 定义文件

- [x] **Step 1: 写 token stats 鉴权测试**

使用 Gin router：

```go
router.GET("/api/cli/token_stats", middleware.CliAccessTokenAuth(), CliTokenStats)
```

断言：

- 缺少 Authorization 返回 401。
- 无效 token 返回失败。

- [x] **Step 2: 写 token stats 成功测试**

准备：

- 创建用户和 `AccessToken`。
- 创建至少两个 token。
- 写入测试日志或 mock 可被 `model.GetUserTokenStats` 聚合的数据。

断言：

- 返回 `success=true`。
- 只返回当前用户统计。
- 支持 `start_timestamp`、`end_timestamp` query。

- [x] **Step 3: 运行失败测试**

Run:

```bash
cd "newapi"
go test ./controller -run TestCliTokenStatsHTTP -v
```

Expected: FAIL，`CliTokenStats` 未定义或未挂载。

- [x] **Step 4: 实现 `CliTokenStats`**

实现方式与 `GetUserTokenConsumeStats` 保持一致，但用户来自 `CliAccessTokenAuth`：

```go
func CliTokenStats(c *gin.Context) {
    userId := c.GetInt("id")
    startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
    endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)

    now := common.GetTimestamp()
    if endTimestamp <= 0 {
        endTimestamp = now
    }
    if startTimestamp <= 0 {
        startTimestamp = now - 30*24*3600
    }

    stats, err := model.GetUserTokenStats(userId, startTimestamp, endTimestamp)
    if err != nil {
        common.ApiError(c, err)
        return
    }
    common.ApiSuccess(c, stats)
}
```

- [x] **Step 5: 运行测试**

Run:

```bash
cd "newapi"
go test ./controller -run TestCliTokenStatsHTTP -v
```

Expected: PASS。

## Task 6: 回归验证

**Files:**

- Modify: `newapi/router/api-router.go`
- Modify: `newapi/controller/cli.go`
- Modify/Create: tests listed above

- [x] **Step 1: 运行 CLI controller/router 相关测试**

Run:

```bash
cd "newapi"
go test ./controller ./router -run 'Cli|TokenStats' -v
```

Expected: PASS。

- [x] **Step 2: 运行完整 controller/router 测试**

Run:

```bash
cd "newapi"
go test ./controller ./router
```

Expected: PASS。

- [x] **Step 3: 检查没有生产环境依赖**

确认测试只使用内存 SQLite 或本地测试配置，不连接生产服务器，不访问 `claude360.xyz` 生产接口。

- [x] **Step 4: 更新接口说明**

若项目已有 CLI API 文档，将新增接口补充到对应文档；不要修改 `claude360-Copilot/doc/01-*.md` 到 `07-*.md`。

## Risk Notes

- `POST /api/cli/auth/password` 必须保留 `middleware.TurnstileCheck()`，不能为了桌面端便利绕过人机验证。
- 2FA challenge 不能复用浏览器 session，否则桌面端登录会依赖 cookie。
- challenge 成功换 token 后必须一次性消费，避免重放。
- 错误验证码不要立即消费 challenge，避免用户输错一次就必须重新输入密码。
- `cli_token` 是 user access token，日志和错误信息中不得输出明文。
