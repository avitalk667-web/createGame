using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace PortalX.Tests;

/// <summary>
/// End-to-end over HTTP + SignalR against the real PostgreSQL test database (portalx_test):
/// four simulated players create, join, start and finish a full game.
/// </summary>
[Collection(DatabaseCollection.Name)]
public class HubIntegrationTests
{
    public sealed class Factory : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            var pass = Environment.GetEnvironmentVariable("PORTALX_PG_PASSWORD")
                ?? File.ReadAllText(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PortalX", "pg.pass")).Trim();
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, cfg) => cfg.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Default"] = $"Host=localhost;Port=5433;Database=portalx_test;Username=portalx;Password={pass}",
                ["Payments:Provider"] = "sandbox",
                ["RateLimits:CreatePerMinute"] = "100000",
                ["RateLimits:JoinPerMinute"] = "100000",
                ["RateLimits:AdminLoginPerMinute"] = "100000",
                ["RateLimits:FreeGamesPerHour"] = "100000",
                ["RateLimits:CouponPerMinute"] = "100000",
                ["RateLimits:TestGamesPerHour"] = "100000",
                ["Admin:Username"] = AdminTests.Username,
                ["Admin:PasswordHash"] = PortalX.Server.Admin.AdminAuth.HashPassword(AdminTests.Password),
            }));
        }
    }

    private readonly Factory _factory;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public HubIntegrationTests(Factory factory) => _factory = factory;

    private sealed class Client : IAsyncDisposable
    {
        public required HubConnection Conn { get; init; }
        public required string Token { get; init; }
        public string PlayerId { get; set; } = "";
        public ConcurrentQueue<JsonElement> States { get; } = new();
        public ConcurrentQueue<JsonElement> Notices { get; } = new();
        public ConcurrentQueue<JsonElement> Chats { get; } = new();
        public JsonElement? LastState => States.LastOrDefault();
        public ValueTask DisposeAsync() => Conn.DisposeAsync();
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

    private async Task<Client> JoinAsync(HttpClient http, string code, string nickname, string character, string? hostClaim = null)
    {
        var res = await http.PostAsJsonAsync($"/api/rooms/{code}/players", new { nickname, characterId = character, appearance = "{\"skin\":1}", hostClaim });
        var body = await res.Content.ReadFromJsonAsync<JsonElement>(Json);
        Assert.True(res.IsSuccessStatusCode, body.ToString());
        var c = new Client { Conn = NewConnection(), Token = body.GetProperty("token").GetString()! };
        c.Conn.On<JsonElement>("state", s => c.States.Enqueue(s));
        c.Conn.On<JsonElement>("notice", n => c.Notices.Enqueue(n));
        c.Conn.On<JsonElement>("chat", m => c.Chats.Enqueue(m));
        await c.Conn.StartAsync();
        var r = await c.Conn.InvokeAsync<JsonElement>("Connect", c.Token);
        Assert.True(r.GetProperty("ok").GetBoolean(), r.ToString());
        c.PlayerId = r.GetProperty("data").GetProperty("playerId").GetString()!;
        c.States.Enqueue(r.GetProperty("snapshot"));
        return c;
    }

    private static async Task<JsonElement> Ok(Task<JsonElement> call)
    {
        var r = await call;
        Assert.True(r.GetProperty("ok").GetBoolean(), r.ToString());
        return r;
    }

    private static async Task WaitFor(Func<bool> cond, string what)
    {
        for (var i = 0; i < 100 && !cond(); i++) await Task.Delay(50);
        Assert.True(cond(), "Timed out waiting for " + what);
    }

    private static string Phase(JsonElement? s) => s?.GetProperty("phase").GetString() ?? "";

    [Fact]
    public async Task Four_players_play_a_full_game_in_sync()
    {
        var http = _factory.CreateClient();
        var (code, hostClaim) = await TestPurchase.PaidRoomAsync(http, _factory.Services);
        Assert.Equal(6, code.Length);

        var host = await JoinAsync(http, code, "ישראל", "explorer", hostClaim);
        var dovid = await JoinAsync(http, code, "דוד", "scholar");
        var uri = await JoinAsync(http, code, "אורי", "navigator");
        var moshe = await JoinAsync(http, code, "משה", "detective");
        var all = new[] { host, dovid, uri, moshe };

        await WaitFor(() => host.LastState?.GetProperty("players").GetArrayLength() == 4, "host to see 4 players");
        Assert.Equal(host.PlayerId, host.LastState!.Value.GetProperty("hostPlayerId").GetString());

        // Non-host cannot start; host cannot start before everyone is ready.
        var bad = await dovid.Conn.InvokeAsync<JsonElement>("StartGame");
        Assert.Equal("not-host", bad.GetProperty("code").GetString());
        Assert.Equal("not-ready", (await host.Conn.InvokeAsync<JsonElement>("StartGame")).GetProperty("code").GetString());

        foreach (var c in all.Skip(1)) await Ok(c.Conn.InvokeAsync<JsonElement>("SetReady", true));
        await Ok(host.Conn.InvokeAsync<JsonElement>("StartGame"));
        await WaitFor(() => all.All(c => Phase(c.LastState) == "intro"), "everyone in intro");
        await Ok(host.Conn.InvokeAsync<JsonElement>("FinishIntro", true));
        await WaitFor(() => all.All(c => Phase(c.LastState) == "playing"), "everyone playing");

        // Chat is filtered and relayed.
        await Ok(dovid.Conn.InvokeAsync<JsonElement>("SendChat", "מצאתי רמז!", (string?)null));
        Assert.False((await dovid.Conn.InvokeAsync<JsonElement>("SendChat", "אתה טיפש", (string?)null)).GetProperty("ok").GetBoolean());
        await WaitFor(() => moshe.Chats.Count == 1, "chat relay");

        // The library key book shows each player only half of the table.
        var keyHost = (await Ok(host.Conn.InvokeAsync<JsonElement>("GetPersonalClues", "p1-cipher"))).GetProperty("data").GetProperty("key");
        var keyDovid = (await Ok(dovid.Conn.InvokeAsync<JsonElement>("GetPersonalClues", "p1-cipher"))).GetProperty("data").GetProperty("key");
        Assert.Equal(4, keyHost.GetArrayLength());
        Assert.NotEqual(keyHost[0].GetProperty("symbol").GetString(), keyDovid[0].GetProperty("symbol").GetString());

        await Ok(moshe.Conn.InvokeAsync<JsonElement>("PickUp", "handle", "a-1"));
        // Wrong answer then a duplicated correct submission with the same action id is processed once.
        var wrong = await dovid.Conn.InvokeAsync<JsonElement>("SubmitAnswer", "p1-cipher", JsonSerializer.SerializeToElement("דלת"), "a-2");
        Assert.Equal("wrong", wrong.GetProperty("code").GetString());
        await Ok(dovid.Conn.InvokeAsync<JsonElement>("SubmitAnswer", "p1-cipher", JsonSerializer.SerializeToElement("שער"), "a-3"));
        var dup = await dovid.Conn.InvokeAsync<JsonElement>("SubmitAnswer", "p1-cipher", JsonSerializer.SerializeToElement("שער"), "a-3");
        Assert.Equal("duplicate", dup.GetProperty("code").GetString());

        await Ok(uri.Conn.InvokeAsync<JsonElement>("RequestHint", "p2-sequence", "a-4"));
        await WaitFor(() => host.Notices.Any(n => n.GetProperty("kind").GetString() == "hint"), "hint broadcast");
        await Ok(uri.Conn.InvokeAsync<JsonElement>("SubmitAnswer", "p2-sequence", JsonSerializer.SerializeToElement(new[] { "sun", "crown", "leaf", "star" }), "a-5"));

        var tune = await Ok(host.Conn.InvokeAsync<JsonElement>("GetTune", "p3-sound"));
        var seq = tune.GetProperty("data").GetProperty("sequence").EnumerateArray().Select(e => e.GetString()).ToArray();
        await Ok(host.Conn.InvokeAsync<JsonElement>("SubmitAnswer", "p3-sound", JsonSerializer.SerializeToElement(seq), "a-6"));

        // Each player sees a different mirror clue.
        var clueIdx = new List<int>();
        foreach (var c in all)
        {
            var r = await Ok(c.Conn.InvokeAsync<JsonElement>("GetPersonalClues", "p4-split"));
            var clues = r.GetProperty("data").GetProperty("clues");
            Assert.Equal(1, clues.GetArrayLength());
            clueIdx.Add(clues[0].GetProperty("index").GetInt32());
        }
        Assert.Equal(3, clueIdx.Distinct().Count());
        await Ok(moshe.Conn.InvokeAsync<JsonElement>("SubmitAnswer", "p4-split", JsonSerializer.SerializeToElement("749"), "a-8"));
        // the group stays to read; it moves together only when the host presses "Continue"
        await WaitFor(() => all.All(c => c.LastState?.GetProperty("pendingZone").GetString() == "items"), "the next room waiting");
        Assert.Equal("library", host.LastState!.Value.GetProperty("activeZone").GetString());
        Assert.Equal("not-host", (await moshe.Conn.InvokeAsync<JsonElement>("Continue")).GetProperty("code").GetString());
        await Ok(host.Conn.InvokeAsync<JsonElement>("Continue"));
        await WaitFor(() => all.All(c => c.LastState?.GetProperty("activeZone").GetString() == "items"), "all clients in the items room");
        await Ok(host.Conn.InvokeAsync<JsonElement>("Combine", "handle", "gear", "a-10"));
        await Ok(dovid.Conn.InvokeAsync<JsonElement>("PlaceItem", "p5-items", "crystal", "a-11"));
        await Ok(uri.Conn.InvokeAsync<JsonElement>("PlaceItem", "p5-items", "mechanism", "a-12"));

        // A player drops and reconnects with the same token: the current state comes back.
        await moshe.Conn.StopAsync();
        await WaitFor(() => host.LastState!.Value.GetProperty("players").EnumerateArray()
            .Any(p => p.GetProperty("nickname").GetString() == "משה" && !p.GetProperty("isConnected").GetBoolean()), "disconnect seen");
        await using var moshe2 = new Client { Conn = NewConnection(), Token = moshe.Token };
        await moshe2.Conn.StartAsync();
        var re = await Ok(moshe2.Conn.InvokeAsync<JsonElement>("Connect", moshe.Token));
        Assert.Equal(5, re.GetProperty("snapshot").GetProperty("letters").GetArrayLength());
        Assert.Contains("portal", re.GetProperty("snapshot").GetProperty("unlockedZones").EnumerateArray().Select(z => z.GetString()));

        await Ok(moshe2.Conn.InvokeAsync<JsonElement>("SubmitAnswer", "p6-final", JsonSerializer.SerializeToElement("אמונה"), "a-13"));
        await WaitFor(() => all.Take(3).All(c => Phase(c.LastState) == "completed"), "everyone completed");
        var result = host.LastState!.Value.GetProperty("result");
        Assert.Equal(6, result.GetProperty("puzzlesSolved").GetInt32());
        Assert.Equal(4, result.GetProperty("playersCount").GetInt32());
        Assert.Equal(1, result.GetProperty("hintsUsed").GetInt32());

        // Replay returns everybody to the lobby.
        await Ok(host.Conn.InvokeAsync<JsonElement>("PlayAgain"));
        await WaitFor(() => Phase(dovid.LastState) == "lobby", "replay lobby");

        foreach (var c in all) await c.DisposeAsync();
    }

    [Fact]
    public async Task Rooms_are_isolated_and_bad_codes_are_rejected()
    {
        var http = _factory.CreateClient();
        var a = await TestPurchase.PaidRoomAsync(http, _factory.Services);
        var b = await TestPurchase.PaidRoomAsync(http, _factory.Services);
        var ca = await JoinAsync(http, a.Code, "אליהו", "explorer", a.HostClaim);
        var cb = await JoinAsync(http, b.Code, "שמואל", "scholar", b.HostClaim);
        await Ok(ca.Conn.InvokeAsync<JsonElement>("SendChat", "שלום", (string?)null));
        await Task.Delay(300);
        Assert.Empty(cb.Chats);
        Assert.Single(ca.LastState!.Value.GetProperty("players").EnumerateArray());

        var missing = await http.GetAsync("/api/rooms/ZZZZZZ");
        Assert.Equal(System.Net.HttpStatusCode.NotFound, missing.StatusCode);
        var badToken = NewConnection();
        await badToken.StartAsync();
        var r = await badToken.InvokeAsync<JsonElement>("Connect", "not-a-token");
        Assert.Equal("bad-token", r.GetProperty("code").GetString());

        // Host revokes the invite: old code stops working, the room keeps its players.
        var oldCode = a.Code;
        await Ok(ca.Conn.InvokeAsync<JsonElement>("RegenerateCode"));
        Assert.Equal(System.Net.HttpStatusCode.NotFound, (await http.GetAsync($"/api/rooms/{oldCode}")).StatusCode);

        await badToken.DisposeAsync();
        await ca.DisposeAsync();
        await cb.DisposeAsync();
    }

    [Fact]
    public async Task Public_api_never_exposes_solutions()
    {
        var http = _factory.CreateClient();
        var json = await http.GetStringAsync("/api/scenarios/last-portal");
        Assert.Contains("הפורטל האחרון", json);
        Assert.DoesNotContain("solution", json);
        Assert.DoesNotContain("749", json);
    }

    /// <summary>Hanukkah game over SignalR: two players stay in sync, scores reach both and are stored once, a reconnect keeps them.</summary>
    [Fact]
    public async Task Hanukkah_two_players_sync_scores_and_reconnect()
    {
        var http = _factory.CreateClient();
        var (code, hostClaim) = await TestPurchase.PaidRoomAsync(http, _factory.Services, "hanukkah-oil");
        var host = await JoinAsync(http, code, "ישראל", "explorer", hostClaim);
        var guest = await JoinAsync(http, code, "דוד", "scholar");
        await Ok(guest.Conn.InvokeAsync<JsonElement>("SetReady", true));
        await Ok(host.Conn.InvokeAsync<JsonElement>("StartGame"));
        await Ok(host.Conn.InvokeAsync<JsonElement>("FinishIntro", true));

        // the guest finds the letter; the same click sent twice and a second click score once
        var clue = await Ok(guest.Conn.InvokeAsync<JsonElement>("DiscoverClue", "r1-letter", "a1"));
        await guest.Conn.InvokeAsync<JsonElement>("DiscoverClue", "r1-letter", "a1");
        await guest.Conn.InvokeAsync<JsonElement>("DiscoverClue", "r1-letter", "a2");
        Assert.Contains("חידה", clue.GetProperty("message").GetString());

        var solved = await Ok(host.Conn.InvokeAsync<JsonElement>("SubmitAnswer", "h1-riddle", JsonSerializer.SerializeToElement("פך השמן"), "a3"));
        Assert.Equal("solved", solved.GetProperty("code").GetString());

        await WaitFor(() => guest.Notices.Any(n => n.GetProperty("kind").GetString() == "zone-unlocked"));
        await Ok(host.Conn.InvokeAsync<JsonElement>("Continue")); // the group moves on when the host continues
        await WaitFor(() => guest.LastState?.GetProperty("activeZone").GetString() == "workshop");
        Assert.Contains(guest.Notices, n => n.GetProperty("kind").GetString() == "team-solved" && n.GetProperty("message").GetString() == "הקבוצה פתרה את החידה!");
        Assert.Contains(guest.Notices, n => n.GetProperty("kind").GetString() == "clue" && n.GetProperty("message").GetString() == "דוד גילה רמז!");
        Assert.Contains(host.Notices, n => n.GetProperty("kind").GetString() == "score" && n.GetProperty("points").GetInt32() == 25);

        var state = guest.LastState!.Value;
        Assert.Contains("workshop", state.GetProperty("unlockedZones").EnumerateArray().Select(z => z.GetString()));
        var score = state.GetProperty("score");
        Assert.Equal(100, score.GetProperty("group").GetInt32());
        int Points(JsonElement s, string id) => s.GetProperty("players").EnumerateArray().First(p => p.GetProperty("playerId").GetString() == id).GetProperty("points").GetInt32();
        Assert.Equal(25, Points(score, host.PlayerId));
        Assert.Equal(10, Points(score, guest.PlayerId));

        // stored once each in the database
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<PortalX.Server.Data.PortalDbContext>();
            var roomId = Guid.Parse(state.GetProperty("roomId").GetString()!);
            var rows = await db.ScoreEvents.Where(e => e.RoomId == roomId).ToListAsync();
            Assert.Single(rows, e => e.Key == "clue:r1-letter" && e.Points == 10);
            Assert.Single(rows, e => e.Key == "answer:h1-riddle" && e.Points == 25);
            Assert.Single(rows, e => e.Key == "room:library" && e.Points == 100 && e.PlayerId == null);
        }

        // the guest drops and comes back with the same seat and score
        var token = guest.Token;
        await guest.DisposeAsync();
        var back = NewConnection();
        await back.StartAsync();
        var again = await back.InvokeAsync<JsonElement>("Connect", token);
        Assert.True(again.GetProperty("ok").GetBoolean());
        Assert.Equal(10, Points(again.GetProperty("snapshot").GetProperty("score"), guest.PlayerId));
        Assert.Equal("workshop", again.GetProperty("snapshot").GetProperty("activeZone").GetString());
        await back.DisposeAsync();
        await host.DisposeAsync();
    }

    /// <summary>
    /// Spec 13ב: a player closes the tab (or the browser) and returns with the game code — the seat cookie brings
    /// back the same participant; the count does not grow; the cookie works only for its own game and owner.
    /// </summary>
    [Fact]
    public async Task Returning_after_closing_the_tab_is_the_same_participant()
    {
        var buyer = _factory.CreateClient();
        var (code, hostClaim) = await TestPurchase.PaidRoomAsync(buyer, _factory.Services, "hanukkah-oil");
        var host = await JoinAsync(buyer, code, "ישראל", "explorer", hostClaim);

        // the guest's browser: its HttpClient keeps cookies like a browser does
        var browser = _factory.CreateClient();
        var join = await browser.PostAsJsonAsync($"/api/rooms/{code}/players", new { nickname = "דוד", characterId = "scholar", appearance = "{}" });
        join.EnsureSuccessStatusCode();
        var setCookie = join.Headers.GetValues("Set-Cookie").Single();
        Assert.Contains("httponly", setCookie.ToLowerInvariant());
        var joined = await join.Content.ReadFromJsonAsync<JsonElement>(Json);
        var guestId = joined.GetProperty("playerId").GetString();
        var roomId = joined.GetProperty("roomId").GetString()!;
        var cookie = setCookie.Split(';')[0];

        // the tab is closed (nothing kept in the page); the join page asks "do I have a seat here?"
        var seat = await browser.GetFromJsonAsync<JsonElement>($"/api/rooms/{code}/seat");
        Assert.Equal(guestId, seat.GetProperty("seat").GetProperty("playerId").GetString());
        Assert.Equal("דוד", seat.GetProperty("seat").GetProperty("nickname").GetString());
        Assert.True(seat.GetProperty("seat").GetProperty("canReturn").GetBoolean());

        HubConnection Seated(string cookieHeader) => new HubConnectionBuilder()
            .WithUrl(new Uri(_factory.Server.BaseAddress, "/hubs/game"), o =>
            {
                o.Transports = HttpTransportType.LongPolling;
                o.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                o.Headers["Cookie"] = cookieHeader;
            }).Build();

        await using (var back = Seated(cookie))
        {
            await back.StartAsync();
            var r = await back.InvokeAsync<JsonElement>("ConnectSeat", roomId);
            Assert.True(r.GetProperty("ok").GetBoolean(), r.ToString());
            Assert.Equal(guestId, r.GetProperty("data").GetProperty("playerId").GetString());
            var players = r.GetProperty("snapshot").GetProperty("players");
            Assert.Equal(2, players.GetArrayLength());                                    // no duplicate
            Assert.Single(players.EnumerateArray(), p => p.GetProperty("nickname").GetString() == "דוד");
        }

        // someone else's browser has no seat, a forged cookie gets nothing, and the cookie does not open another game
        var other = _factory.CreateClient();
        var noSeat = await other.GetFromJsonAsync<JsonElement>($"/api/rooms/{code}/seat");
        Assert.True(!noSeat.TryGetProperty("seat", out var s0) || s0.ValueKind == JsonValueKind.Null); // null fields are omitted
        await using (var forged = Seated($"px_seat_{Guid.Parse(roomId):N}=not-a-real-token"))
        {
            await forged.StartAsync();
            Assert.Equal("bad-token", (await forged.InvokeAsync<JsonElement>("ConnectSeat", roomId)).GetProperty("code").GetString());
        }
        await using (var wrongGame = Seated(cookie.Replace(Guid.Parse(roomId).ToString("N"), Guid.NewGuid().ToString("N"))))
        {
            await wrongGame.StartAsync();
            Assert.Equal("bad-token", (await wrongGame.InvokeAsync<JsonElement>("ConnectSeat", Guid.NewGuid().ToString())).GetProperty("code").GetString());
        }
        await host.DisposeAsync();
    }

    /// <summary>Spec 13ב.7: a newcomer can join a game that is already in progress and lands in the current room.</summary>
    [Fact]
    public async Task A_new_player_can_join_a_game_in_progress()
    {
        var http = _factory.CreateClient();
        var (code, hostClaim) = await TestPurchase.PaidRoomAsync(http, _factory.Services, "hanukkah-oil");
        var host = await JoinAsync(http, code, "ישראל", "explorer", hostClaim);
        await Ok(host.Conn.InvokeAsync<JsonElement>("StartGame"));
        await Ok(host.Conn.InvokeAsync<JsonElement>("FinishIntro", true));
        await Ok(host.Conn.InvokeAsync<JsonElement>("SubmitAnswer", "h1-riddle", JsonSerializer.SerializeToElement("פך השמן"), "j1"));
        await Ok(host.Conn.InvokeAsync<JsonElement>("Continue"));

        var info = await http.GetFromJsonAsync<JsonElement>($"/api/rooms/{code}");
        Assert.Equal("playing", info.GetProperty("phase").GetString());
        Assert.True(info.GetProperty("canJoin").GetBoolean());
        var late = await JoinAsync(_factory.CreateClient(), code, "שמואל", "navigator");
        var s = late.LastState!.Value;
        Assert.Equal("playing", s.GetProperty("phase").GetString());
        Assert.Equal("workshop", s.GetProperty("activeZone").GetString());
        Assert.Contains("antique-key", s.GetProperty("inventory").EnumerateArray().Select(x => x.GetString()));
        Assert.Contains(s.GetProperty("puzzles").EnumerateArray(), p => p.GetProperty("id").GetString() == "h1-riddle" && p.GetProperty("status").GetString() == "solved");
        await late.DisposeAsync();
        await host.DisposeAsync();
    }

    private static async Task WaitFor(Func<bool> condition)
    {
        for (var i = 0; i < 50 && !condition(); i++) await Task.Delay(100);
        Assert.True(condition());
    }
}
