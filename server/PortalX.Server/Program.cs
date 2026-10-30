using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.SignalR;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using PortalX.Server;
using PortalX.Server.Admin;
using PortalX.Server.Content;
using PortalX.Server.Data;
using PortalX.Server.Game;
using PortalX.Server.Hubs;
using PortalX.Server.Payments;

// `PortalX.Server --hash-password`: reads a password from standard input and prints the hash for Admin__PasswordHash.
if (args.Contains("--hash-password"))
{
    // PowerShell may prefix piped text with a byte-order mark; it is never part of the password
    var password = (Console.In.ReadLine() ?? "").TrimStart((char)0xFEFF).TrimEnd((char)13);
    if (password.Length < 12) { Console.Error.WriteLine("Use at least 12 characters."); return 1; }
    Console.WriteLine(AdminAuth.HashPassword(password));
    return 0;
}

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<PortalDbContext>((sp, o) => o.UseNpgsql(
    DatabaseConfig.Resolve(sp.GetRequiredService<IConfiguration>()),
    // retry transient failures, e.g. right after the computer wakes from sleep
    npgsql => npgsql.EnableRetryOnFailure(4, TimeSpan.FromSeconds(3), null)));
builder.Services.AddSingleton(_ => ScenarioCatalog.LoadDefault());
builder.Services.AddSingleton(_ => ProductSeed.LoadDefault());
builder.Services.AddSingleton(_ => PortalX.Server.Referrals.CampaignContent.LoadDefault());
builder.Services.AddSingleton(sp => sp.GetRequiredService<IConfiguration>().GetSection("Game").Get<GameOptions>() ?? new GameOptions());
builder.Services.AddSingleton<GameEngine>();
builder.Services.AddSingleton<RoomRuntime>();
builder.Services.AddSingleton<DatabaseStatus>();
builder.Services.AddScoped<RoomService>();
// demo checkout: on only when the server's own settings say so (PAYMENTS_MODE=Test and ENABLE_TEST_CHECKOUT=true)
builder.Services.AddSingleton(sp => TestCheckout.FromConfig(sp.GetRequiredService<IConfiguration>(),
    sp.GetRequiredService<ILoggerFactory>().CreateLogger("Payments")));
builder.Services.AddSingleton(sp => PaymentGateway.Create(
    sp.GetRequiredService<IConfiguration>().GetSection("Payments").Get<PaymentOptions>() ?? new PaymentOptions(),
    sp.GetRequiredService<IHostEnvironment>(), sp.GetRequiredService<ILoggerFactory>().CreateLogger("Payments")));
builder.Services.AddScoped<CouponService>();
builder.Services.AddScoped<PurchaseService>();
builder.Services.Configure<AdminOptions>(builder.Configuration.GetSection("Admin"));
builder.Services.AddScoped<AdminService>();
// email: the contact address, SMTP settings (environment only), results emails, consents and unsubscribe links
builder.Services.AddSingleton(sp => PortalX.Server.Mail.SiteOptions.FromConfig(sp.GetRequiredService<IConfiguration>()));
builder.Services.AddSingleton(sp => PortalX.Server.Mail.ResultsEmailPolicy.FromConfig(sp.GetRequiredService<IConfiguration>()));
// sending: Gmail API over HTTPS with OAuth (no SMTP); the refresh token is kept encrypted in the database
builder.Services.AddSingleton(sp => PortalX.Server.Mail.GoogleMailOptions.FromConfig(sp.GetRequiredService<IConfiguration>(), sp.GetRequiredService<PortalX.Server.Mail.SiteOptions>()));
builder.Services.AddSingleton<PortalX.Server.Mail.GoogleHttp>();
builder.Services.AddSingleton<PortalX.Server.Mail.TokenProtector>();
builder.Services.AddSingleton<PortalX.Server.Mail.GmailAccount>();
builder.Services.AddSingleton<PortalX.Server.Mail.IEmailSender>(sp =>
{
    var google = sp.GetRequiredService<PortalX.Server.Mail.GoogleMailOptions>();
    if (!google.Configured)
        sp.GetRequiredService<ILoggerFactory>().CreateLogger("Mail")
            .LogWarning("Gmail sending is not configured; results emails are not offered. Missing: {Missing}", string.Join(", ", google.Missing()));
    return new PortalX.Server.Mail.GmailEmailSender(sp.GetRequiredService<PortalX.Server.Mail.GmailAccount>());
});
builder.Services.AddScoped<PortalX.Server.Mail.UnsubscribeLinks>();
builder.Services.AddScoped<PortalX.Server.Mail.ResultsEmailService>();
builder.Services.AddScoped<PortalX.Server.Mail.MailingAdmin>();
builder.Services.AddScoped<PortalX.Server.Mail.ConsentRecorder>();
builder.Services.AddScoped<PortalX.Server.Referrals.ReferralService>();
builder.Services.AddScoped<PortalX.Server.Referrals.ReferralAdmin>();
builder.Services.AddHostedService<PortalX.Server.Mail.MailRetentionService>();
builder.Services.AddAdminAuth();

builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
    o.SerializerOptions.Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping;
});
builder.Services.AddSignalR(o =>
{
    o.MaximumReceiveMessageSize = 16 * 1024;
    o.EnableDetailedErrors = builder.Environment.IsDevelopment();
}).AddJsonProtocol(o =>
{
    o.PayloadSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    o.PayloadSerializerOptions.Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping;
});

// Behind a cloud proxy (Render) the real client IP and https scheme arrive in X-Forwarded-* headers;
// needed so rate limiting is per player and not per proxy.
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownNetworks.Clear();
    o.KnownProxies.Clear();
});

// Rate limiting for the public API (spec §19). Limits per IP per minute, configurable (tests raise them).
static int Limit(HttpContext ctx, string key, int fallback) => ctx.RequestServices.GetRequiredService<IConfiguration>().GetValue(key, fallback);
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("create", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "x",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = Limit(ctx, "RateLimits:CreatePerMinute", 10), Window = TimeSpan.FromMinutes(1) }));
    o.AddPolicy("join", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "x",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = Limit(ctx, "RateLimits:JoinPerMinute", 40), Window = TimeSpan.FromMinutes(1) }));
    o.AddPolicy("coupon", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "x",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = Limit(ctx, "RateLimits:CouponPerMinute", 20), Window = TimeSpan.FromMinutes(1) }));
    // free trial games: a few per address per hour, so the free game cannot be used to flood the server
    o.AddPolicy("free-game", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "x",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = Limit(ctx, "RateLimits:FreeGamesPerHour", 6), Window = TimeSpan.FromHours(1) }));
    o.AddPolicy("test-game", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "x",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = Limit(ctx, "RateLimits:TestGamesPerHour", 30), Window = TimeSpan.FromHours(1) }));
    o.AddPolicy("results-email", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "x",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = Limit(ctx, "RateLimits:ResultsEmailPer10Minutes", 10), Window = TimeSpan.FromMinutes(10) }));
    o.AddPolicy("unsubscribe", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "x",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = Limit(ctx, "RateLimits:UnsubscribePerMinute", 20), Window = TimeSpan.FromMinutes(1) }));
    o.AddPolicy("email-admin", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "x",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = Limit(ctx, "RateLimits:EmailAdminPer10Minutes", 15), Window = TimeSpan.FromMinutes(10) }));
    // personal links: creating, mailing again and opening (spec 9, 12)
    o.AddPolicy("referral", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "x",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = Limit(ctx, "RateLimits:ReferralPer10Minutes", 10), Window = TimeSpan.FromMinutes(10) }));
    o.AddPolicy("referral-resend", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "x",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = Limit(ctx, "RateLimits:ReferralResendPer10Minutes", 5), Window = TimeSpan.FromMinutes(10) }));
    o.AddPolicy("referral-visit", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "x",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = Limit(ctx, "RateLimits:ReferralVisitsPerMinute", 30), Window = TimeSpan.FromMinutes(1) }));
    o.AddPolicy("admin-login", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "x",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = Limit(ctx, "RateLimits:AdminLoginPerMinute", 10), Window = TimeSpan.FromMinutes(1) }));
});

var app = builder.Build();

// A database problem must not stop the web server: start anyway, report it on /api/health, keep retrying.
if (!await DatabaseStartup.TryInitializeAsync(app.Services, app.Logger))
    DatabaseStartup.RetryInBackground(app.Services, app.Logger, app.Lifetime.ApplicationStopping);

app.UseForwardedHeaders();
// Until the database is ready, game endpoints answer 503 with a Hebrew message instead of failing.
app.Use(async (ctx, next) =>
{
    var path = ctx.Request.Path;
    if ((path.StartsWithSegments("/api") && !path.StartsWithSegments("/api/health") && !path.StartsWithSegments("/api/version") && !path.StartsWithSegments("/api/scenarios"))
        || path.StartsWithSegments("/hubs"))
    {
        if (!ctx.RequestServices.GetRequiredService<DatabaseStatus>().IsReady)
        {
            ctx.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            ctx.Response.Headers.RetryAfter = "10";
            await ctx.Response.WriteAsJsonAsync(new ApiError("db-starting", "השרת מתחבר למסד הנתונים. נסו שוב בעוד כמה שניות."));
            return;
        }
    }
    await next();
});
app.UseDefaultFiles();
app.UseStaticFiles(StaticCaching.Options);
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

var api = app.MapGroup("/api");

// which commit and front-end bundle are deployed (to verify a deploy)
api.MapGet("/version", (IWebHostEnvironment env) => Results.Ok(StaticCaching.Version(env)));

api.MapGet("/health", (DatabaseStatus db, Microsoft.Extensions.Options.IOptions<AdminOptions> admin) => Results.Ok(new
{
    // whether the admin login is set up and its hash is well-formed (never the hash or the user name)
    adminLogin = AdminAuth.HashStatus(admin.Value),
    status = db.IsReady ? "ok" : "degraded",
    database = db.State,
    problem = db.Problem,
    attempts = db.Attempts,
    time = DateTime.UtcNow,
}));

api.MapGet("/scenarios", (ScenarioCatalog catalog) => catalog.All.Select(s => new
{
    s.Id, s.Name, s.Tagline, s.Description, s.DurationMinutes, s.Difficulty, s.MinPlayers, s.MaxPlayers,
}));

api.MapGet("/scenarios/{id}", (string id, ScenarioCatalog catalog) =>
    catalog.Find(id) is { } s ? Results.Content(Snapshots.PublicScenario(s).ToJsonString(ScenarioCatalog.JsonOptions), "application/json; charset=utf-8") : Results.NotFound());

// Shared catalog of purchasable games (spec §1): only published products, price from the server.
api.MapGet("/products", async (PortalDbContext db, ScenarioCatalog scenarios, PaymentGateway gateway, TestCheckout testCheckout) =>
    (await db.Products.AsNoTracking().Where(p => p.Status == PortalX.Server.Domain.ProductStatus.Published)
        .OrderBy(p => p.SortOrder).ToListAsync()).Select(p => ProductView.Build(p, scenarios, gateway, testCheckout)));

api.MapGet("/products/{id}", async (string id, PortalDbContext db, ScenarioCatalog scenarios, PaymentGateway gateway, TestCheckout testCheckout) =>
    await db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id && p.Status == PortalX.Server.Domain.ProductStatus.Published) is { } p
        ? Results.Ok(ProductView.Build(p, scenarios, gateway, testCheckout))
        : Results.NotFound(new ApiError("no-product", "המשחק לא נמצא.")));

// Group games are opened only through a paid order (POST /api/orders/{id}/game) — no free room creation.
api.MapPurchaseEndpoints(app.Services.GetRequiredService<PaymentGateway>());
api.MapSiteEndpoints();
api.MapTestCheckout();
PortalX.Server.Mail.MailEndpoints.MapMailEndpoints(api);
PortalX.Server.Referrals.ReferralEndpoints.MapReferralEndpoints(api);
api.MapAdminEndpoints();

api.MapGet("/rooms/{code}", async (string code, RoomService rooms, ScenarioCatalog catalog) =>
{
    var room = await rooms.FindByCodeAsync(code);
    if (room == null) return Results.NotFound(new ApiError("no-room", "לא מצאנו חדר עם הקוד הזה. בדקו שהקוד נכון."));
    var scenario = catalog.Get(room.ScenarioId);
    var taken = rooms.Engine.SeatsTaken(room, DateTime.UtcNow);
    return Results.Ok(new
    {
        code = room.Code, scenarioId = room.ScenarioId, scenarioName = scenario.Name,
        phase = room.Phase.ToString().ToLowerInvariant(), playerCount = taken,
        minPlayers = rooms.Engine.MinPlayers(scenario), maxPlayers = rooms.Engine.MaxPlayers(room),
        // open until the game is finished, also in the middle of it, while a seat is free (spec 3)
        canJoin = GameEngine.IsOpenForJoining(room) && taken < rooms.Engine.MaxPlayers(room),
    });
}).RequireRateLimiting("join");

// "Is there already a seat for me in this game?" — read from this game's HttpOnly seat cookie, so a player who
// closed the tab or the browser returns to the same participant instead of joining again (spec 4).
api.MapGet("/rooms/{code}/seat", async (string code, HttpRequest http, RoomService rooms) =>
{
    var room = await rooms.FindByCodeAsync(code);
    if (room == null) return Results.NotFound(new ApiError("no-room", "לא מצאנו חדר עם הקוד הזה. בדקו שהקוד נכון."));
    var token = http.Cookies[RoomService.SeatCookie(room.Id)];
    var player = string.IsNullOrEmpty(token) ? null : room.Players.FirstOrDefault(p => !p.IsRemoved && p.TokenHash == RoomService.Hash(token));
    if (player == null) return Results.Ok(new { seat = (object?)null });
    var now = DateTime.UtcNow;
    var state = rooms.Engine.Seat(player, now);
    var max = rooms.Engine.MaxPlayers(room);
    var canReturn = state != GameEngine.SeatState.Released || rooms.Engine.SeatsTaken(room, now, player.Id) < max;
    return Results.Ok(new
    {
        seat = new
        {
            roomId = room.Id, playerId = player.Id, nickname = player.Nickname, characterId = player.CharacterId,
            status = state.ToString().ToLowerInvariant(), canReturn, isHost = room.HostPlayerId == player.Id,
        },
    });
}).RequireRateLimiting("join");

api.MapPost("/rooms/{code}/players", async (string code, JoinRequest req, HttpContext http, RoomService rooms, Microsoft.AspNetCore.SignalR.IHubContext<GameHub> hub) =>
{
    var room = await rooms.FindByCodeAsync(code);
    if (room == null) return Results.NotFound(new ApiError("no-room", "לא מצאנו חדר עם הקוד הזה. בדקו שהקוד נכון."));
    var token = RoomService.NewToken();
    var claimsHost = !string.IsNullOrEmpty(req.HostClaim) && RoomService.Hash(req.HostClaim) == room.HostClaimHash;
    PortalX.Server.Domain.PlayerSession? created = null;
    var exec = await rooms.ExecuteAsync(room.Id, null, "join", null, null, r =>
    {
        var outcome = rooms.Engine.AddPlayer(r, req.Nickname ?? "", req.CharacterId ?? "", req.Appearance ?? "{}",
            RoomService.Hash(token), claimsHost, DateTime.UtcNow, out var p);
        created = p;
        return outcome;
    });
    if (!exec.Outcome.Ok || created == null) return Results.BadRequest(new ApiError(exec.Outcome.Code, exec.Outcome.Message));
    if (exec.Snapshot != null) await hub.Clients.Group("room:" + room.Id).SendAsync("state", exec.Snapshot);
    foreach (var n in exec.Outcome.Notices) await hub.Clients.Group("room:" + room.Id).SendAsync("notice", n);
    // the seat survives closing the tab or the browser (HttpOnly, this game only)
    http.Response.Cookies.Append(RoomService.SeatCookie(room.Id), token, RoomService.SeatCookieOptions(http.Request));
    return Results.Ok(new { playerId = created.Id, token, roomId = room.Id });
}).RequireRateLimiting("join");

app.MapHub<GameHub>("/hubs/game");
// personal links: "/r/{token}" starts this visit's referral session and opens the home page
PortalX.Server.Referrals.ReferralEndpoints.MapReferralRedirect(app);
// unknown API paths answer 404 instead of falling through to the Angular page
app.Map("/api/{**rest}", () => Results.NotFound(new ApiError("not-found", "הכתובת לא נמצאה.")));
app.MapFallbackToFile("index.html", StaticCaching.Options);

app.Run();
return 0;

public sealed record JoinRequest(string? Nickname, string? CharacterId, string? Appearance, string? HostClaim);
public sealed record ApiError(string Code, string Message);

public partial class Program;
