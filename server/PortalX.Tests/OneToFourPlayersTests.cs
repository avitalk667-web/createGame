using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PortalX.Server.Admin;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>
/// Player limit, home page and reports spec: every game takes 1–4 players (enforced by the server, also for players
/// joining at the same moment, without double seats on a reconnect), and the admin report of the free game.
/// </summary>
[Collection(DatabaseCollection.Name)]
public class OneToFourPlayersTests
{
    private const string FullMessage = "המשחק מלא. אפשר להצטרף לאחר שמתפנה מקום.";
    private static readonly DateTime T0 = new(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly HubIntegrationTests.Factory _factory;

    public OneToFourPlayersTests(HubIntegrationTests.Factory factory) => _factory = factory;

    private static async Task<JsonElement> Body(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>(Json);

    private async Task<T> DbAsync<T>(Func<PortalDbContext, Task<T>> f)
    {
        using var scope = _factory.Services.CreateScope();
        return await f(scope.ServiceProvider.GetRequiredService<PortalDbContext>());
    }

    private HubConnection NewConnection()
    {
        var server = _factory.Server;
        return new HubConnectionBuilder()
            .WithUrl(new Uri(server.BaseAddress, "/hubs/game"), o =>
            {
                o.Transports = HttpTransportType.LongPolling;
                o.HttpMessageHandlerFactory = _ => server.CreateHandler();
            })
            .Build();
    }

    private Task<HttpResponseMessage> Join(string code, string nickname, string character, string? hostClaim = null) =>
        _factory.CreateClient().PostAsJsonAsync($"/api/rooms/{code}/players", new { nickname, characterId = character, appearance = "{}", hostClaim });

    /// <summary>Joins and connects to the game hub; returns the open connection and the player's token.</summary>
    private async Task<(HubConnection Conn, string Token)> PlayAsync(string code, string nickname, string character, string? hostClaim = null)
    {
        var res = await Join(code, nickname, character, hostClaim);
        var body = await Body(res);
        Assert.True(res.IsSuccessStatusCode, body.ToString());
        var token = body.GetProperty("token").GetString()!;
        var conn = NewConnection();
        await conn.StartAsync();
        var r = await conn.InvokeAsync<JsonElement>("Connect", token);
        Assert.True(r.GetProperty("ok").GetBoolean(), r.ToString());
        return (conn, token);
    }

    private async Task<(string Code, string HostClaim)> FreeGameAsync()
    {
        var game = await Body(await _factory.CreateClient().PostAsync("/api/products/gate-of-secrets/free-game", null));
        return (game.GetProperty("code").GetString()!, game.GetProperty("hostClaim").GetString()!);
    }

    private Task<int> SeatsAsync(string code) =>
        DbAsync(db => db.Players.CountAsync(p => !p.IsRemoved && db.Rooms.Any(r => r.Code == code && r.Id == p.RoomId)));

    // ------------------------------------------------------------------ 1–4 players

    [Theory]
    [InlineData("last-portal")]
    [InlineData("hanukkah-oil")]
    [InlineData("gate-of-secrets")]
    public void Every_game_starts_with_a_single_player_and_takes_up_to_four(string scenario)
    {
        var e = new GameEngine(Catalog, new GameOptions());
        Assert.Equal(1, e.MinPlayers(Catalog.Get(scenario)));
        var r = e.CreateRoom(scenario, "SOLO23", "hash", T0);
        Assert.True(e.AddPlayer(r, "יחיד", "explorer", "{}", "t0", true, T0, out var host).Ok);
        host!.IsConnected = true;
        Assert.Null(e.StartBlocker(r));
        Assert.True(e.StartGame(r, host.Id, T0).Ok);
        // the group may still grow to four during the game, never to five
        for (var i = 1; i < 4; i++)
            Assert.True(e.AddPlayer(r, "שחקן" + i, GameEngine.Characters[i], "{}", "t" + i, false, T0, out _).Ok);
        Assert.Equal(FullMessage, e.AddPlayer(r, "חמישי", "explorer", "{}", "t5", false, T0, out _).Message);
    }

    [Fact]
    public void A_left_over_test_setting_cannot_raise_the_minimum_above_one()
    {
        // production once had Game__MinPlayersOverride=2; it may only lower a game's minimum
        var e = new GameEngine(Catalog, new GameOptions { MinPlayersOverride = 2 });
        foreach (var s in Catalog.All) Assert.Equal(1, e.MinPlayers(s));
    }

    [Fact]
    public async Task A_single_player_starts_the_free_game_others_join_and_a_reconnect_keeps_the_same_seat()
    {
        var (code, hostClaim) = await FreeGameAsync();
        var info = await Body(await _factory.CreateClient().GetAsync($"/api/rooms/{code}"));
        Assert.Equal(1, info.GetProperty("minPlayers").GetInt32());
        Assert.Equal(4, info.GetProperty("maxPlayers").GetInt32());

        var host = await PlayAsync(code, "Host", "explorer", hostClaim);
        var start = await host.Conn.InvokeAsync<JsonElement>("StartGame");
        Assert.True(start.GetProperty("ok").GetBoolean(), start.ToString());

        var guest = await PlayAsync(code, "Guest", "scholar");
        var third = await PlayAsync(code, "Third", "navigator");
        Assert.Equal(3, await SeatsAsync(code));

        // the guest drops and comes back with the same token: same seat, no new participant
        await guest.Conn.DisposeAsync();
        var back = NewConnection();
        await back.StartAsync();
        Assert.True((await back.InvokeAsync<JsonElement>("Connect", guest.Token)).GetProperty("ok").GetBoolean());
        Assert.Equal(3, await SeatsAsync(code));

        // two players ask for the last seat at the same moment: exactly one gets it
        var last = await Task.WhenAll(Join(code, "Fourth", "detective"), Join(code, "Fifth", "explorer"));
        Assert.Single(last, r => r.StatusCode == HttpStatusCode.OK);
        var refused = last.Single(r => r.StatusCode != HttpStatusCode.OK);
        Assert.Equal(FullMessage, (await Body(refused)).GetProperty("message").GetString());
        Assert.Equal(4, await SeatsAsync(code));

        await back.DisposeAsync();
        await third.Conn.DisposeAsync();
        await host.Conn.DisposeAsync();
    }

    // ------------------------------------------------------------------ free game report

    private async Task<HttpClient> AdminAsync()
    {
        var http = _factory.CreateClient();
        (await http.PostAsJsonAsync("/api/admin/login", new { username = AdminTests.Username, password = AdminTests.Password })).EnsureSuccessStatusCode();
        http.DefaultRequestHeaders.Add(AdminAuth.CsrfHeader, "1");
        return http;
    }

    private static async Task<JsonElement> DashboardAsync(HttpClient admin) =>
        await Body(await admin.GetAsync("/api/admin/dashboard"));

    private static int Free(JsonElement d, string key) => d.GetProperty("freeGame").GetProperty(key).GetInt32();
    private static int Today(JsonElement d, string key) => d.GetProperty("freeGame").GetProperty("today").GetProperty(key).GetInt32();

    [Fact]
    public async Task The_admin_report_counts_free_games_and_players_once_and_never_as_revenue()
    {
        var admin = await AdminAsync();
        var before = await DashboardAsync(admin);
        Assert.Equal("gate-of-secrets", before.GetProperty("freeGame").GetProperty("productId").GetString());
        Assert.Equal("free", before.GetProperty("freeGame").GetProperty("kind").GetString());

        // one game is opened but never started; another is played by two players, one of whom reconnects
        await FreeGameAsync();
        var (code, hostClaim) = await FreeGameAsync();
        var host = await PlayAsync(code, "Host", "explorer", hostClaim);
        var guest = await PlayAsync(code, "Guest", "scholar");
        await guest.Conn.DisposeAsync();
        var back = NewConnection();
        await back.StartAsync();
        Assert.True((await back.InvokeAsync<JsonElement>("Connect", guest.Token)).GetProperty("ok").GetBoolean());
        Assert.True((await back.InvokeAsync<JsonElement>("SetReady", true)).GetProperty("ok").GetBoolean());
        Assert.True((await host.Conn.InvokeAsync<JsonElement>("StartGame")).GetProperty("ok").GetBoolean());
        // refreshing the page reads the game again; it is still one game
        await _factory.CreateClient().GetAsync($"/api/rooms/{code}");

        var mid = await DashboardAsync(admin);
        Assert.Equal(Free(before, "created") + 2, Free(mid, "created"));
        Assert.Equal(Free(before, "started") + 1, Free(mid, "started"));
        Assert.Equal(Free(before, "notStarted") + 1, Free(mid, "notStarted"));
        Assert.Equal(Free(before, "participants") + 2, Free(mid, "participants"));
        Assert.Equal(Free(before, "participantsInStarted") + 2, Free(mid, "participantsInStarted"));
        Assert.Equal(Today(before, "started") + 1, Today(mid, "started"));
        Assert.Equal(Today(before, "joined") + 2, Today(mid, "joined"));
        Assert.Equal(JsonValueKind.String, mid.GetProperty("freeGame").GetProperty("lastStartedAt").ValueKind);

        // the group reaches the end of the game
        await DbAsync(async db =>
        {
            var room = await db.Rooms.FirstAsync(r => r.Code == code);
            room.Phase = RoomPhase.Completed;
            room.EndedAt = DateTime.UtcNow;
            return await db.SaveChangesAsync();
        });
        var after = await DashboardAsync(admin);
        Assert.Equal(Free(before, "completed") + 1, Free(after, "completed"));
        Assert.Equal(Today(before, "completed") + 1, Today(after, "completed"));

        // free games are never revenue, also not in the per-game table
        Assert.Equal(before.GetProperty("revenue").GetProperty("gross").GetDecimal(), after.GetProperty("revenue").GetProperty("gross").GetDecimal());
        var row = after.GetProperty("byProduct").EnumerateArray().First(p => p.GetProperty("productId").GetString() == "gate-of-secrets");
        Assert.True(row.GetProperty("isFree").GetBoolean());
        Assert.Equal(0m, row.GetProperty("money").GetProperty("gross").GetDecimal());
        Assert.True(row.GetProperty("games").GetInt32() >= 2);

        // the history of runs: the games table filtered to the free game
        var games = await Body(await admin.GetAsync("/api/admin/games?access=free-sample&productId=gate-of-secrets"));
        var mine = games.EnumerateArray().First(g => g.GetProperty("code").GetString() == code);
        Assert.Equal("completed", mine.GetProperty("status").GetString());
        Assert.Equal(2, mine.GetProperty("players").GetInt32());
        Assert.Equal(JsonValueKind.String, mine.GetProperty("startedAt").ValueKind);

        await back.DisposeAsync();
        await host.Conn.DisposeAsync();
    }

    [Fact]
    public async Task Visitors_cannot_read_the_reports_through_the_api()
    {
        var http = _factory.CreateClient();
        foreach (var url in new[] { "/api/admin/dashboard", "/api/admin/games?access=free-sample", "/api/admin/orders" })
        {
            var r = await http.GetAsync(url);
            Assert.True(r.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden, url + " " + r.StatusCode);
            Assert.DoesNotContain("freeGame", await r.Content.ReadAsStringAsync());
        }
    }
}
