using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.SignalR;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Content;
using PortalX.Server.Data;
using PortalX.Server.Game;
using PortalX.Server.Hubs;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<PortalDbContext>((sp, o) => o.UseNpgsql(
    DatabaseConfig.Resolve(sp.GetRequiredService<IConfiguration>()),
    // retry transient failures, e.g. right after the computer wakes from sleep
    npgsql => npgsql.EnableRetryOnFailure(4, TimeSpan.FromSeconds(3), null)));
builder.Services.AddSingleton(_ => ScenarioCatalog.LoadDefault());
builder.Services.AddSingleton(sp => sp.GetRequiredService<IConfiguration>().GetSection("Game").Get<GameOptions>() ?? new GameOptions());
builder.Services.AddSingleton<GameEngine>();
builder.Services.AddSingleton<RoomRuntime>();
builder.Services.AddScoped<RoomService>();

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

// Rate limiting for the public API (spec §19).
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("create", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "x",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
    o.AddPolicy("join", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "x",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 40, Window = TimeSpan.FromMinutes(1) }));
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    try
    {
        app.Logger.LogInformation("Database: {Target}", DatabaseConfig.Describe(DatabaseConfig.Resolve(app.Configuration)));
        var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
        await PortalDbContext.InitializeAsync(db, scope.ServiceProvider.GetRequiredService<ScenarioCatalog>());
        app.Logger.LogInformation("Database ready.");
    }
    catch (Exception ex)
    {
        app.Logger.LogCritical(ex, "Cannot reach PostgreSQL. Locally: start-portalx.ps1 starts it. In the cloud: check the DATABASE_URL environment variable.");
        throw;
    }
}

app.UseForwardedHeaders();
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseRateLimiter();

var api = app.MapGroup("/api");

api.MapGet("/health", () => Results.Ok(new { status = "ok", time = DateTime.UtcNow }));

api.MapGet("/scenarios", (ScenarioCatalog catalog) => catalog.All.Select(s => new
{
    s.Id, s.Name, s.Tagline, s.Description, s.DurationMinutes, s.Difficulty, s.MinPlayers, s.MaxPlayers,
}));

api.MapGet("/scenarios/{id}", (string id, ScenarioCatalog catalog) =>
    catalog.Find(id) is { } s ? Results.Content(Snapshots.PublicScenario(s).ToJsonString(ScenarioCatalog.JsonOptions), "application/json; charset=utf-8") : Results.NotFound());

api.MapPost("/rooms", async (CreateRoomRequest req, RoomService rooms, ScenarioCatalog catalog) =>
{
    if (catalog.Find(req.ScenarioId ?? "") == null) return Results.BadRequest(new ApiError("unknown-scenario", "ההרפתקה לא נמצאה."));
    var (room, hostClaim) = await rooms.CreateRoomAsync(req.ScenarioId!);
    return Results.Ok(new { code = room.Code, hostClaim });
}).RequireRateLimiting("create");

api.MapGet("/rooms/{code}", async (string code, RoomService rooms, ScenarioCatalog catalog) =>
{
    var room = await rooms.FindByCodeAsync(code);
    if (room == null) return Results.NotFound(new ApiError("no-room", "לא מצאנו חדר עם הקוד הזה. בדקו שהקוד נכון."));
    var scenario = catalog.Get(room.ScenarioId);
    var count = room.Players.Count(p => !p.IsRemoved);
    return Results.Ok(new
    {
        code = room.Code, scenarioId = room.ScenarioId, scenarioName = scenario.Name,
        phase = room.Phase.ToString().ToLowerInvariant(), playerCount = count, maxPlayers = scenario.MaxPlayers,
        canJoin = room.Phase == PortalX.Server.Domain.RoomPhase.Lobby && count < scenario.MaxPlayers,
    });
}).RequireRateLimiting("join");

api.MapPost("/rooms/{code}/players", async (string code, JoinRequest req, RoomService rooms, Microsoft.AspNetCore.SignalR.IHubContext<GameHub> hub) =>
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
    return Results.Ok(new { playerId = created.Id, token, roomId = room.Id });
}).RequireRateLimiting("join");

app.MapHub<GameHub>("/hubs/game");
app.MapFallbackToFile("index.html");

app.Run();

public sealed record CreateRoomRequest(string? ScenarioId);
public sealed record JoinRequest(string? Nickname, string? CharacterId, string? Appearance, string? HostClaim);
public sealed record ApiError(string Code, string Message);

public partial class Program;
