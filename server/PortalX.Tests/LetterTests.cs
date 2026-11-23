using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PortalX.Server.Data;
using PortalX.Server.Domain;

namespace PortalX.Tests;

/// <summary>
/// The private letters of "הצופן הזוגי" over the real hub and database: saved before delivered, delivered only to the
/// other player, kept through a disconnect, opened once, sealed at rest, never in the game log, and closed to everyone else.
/// </summary>
[Collection(DatabaseCollection.Name)]
public class LetterTests(HubIntegrationTests.Factory factory)
{
    private const string ProductId = "test-couples";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private sealed class Seat : IAsyncDisposable
    {
        public required HubConnection Conn { get; set; }
        public required string Token { get; init; }
        public string PlayerId { get; set; } = "";
        public ConcurrentQueue<JsonElement> Letters { get; } = new();
        public ConcurrentQueue<JsonElement> Opened { get; } = new();
        public ValueTask DisposeAsync() => Conn.DisposeAsync();
    }

    private async Task EnsureProductAsync()
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
        if (await db.Products.AnyAsync(p => p.Id == ProductId)) return;
        db.Products.Add(new Product
        {
            Id = ProductId, Name = "בדיקת הצופן הזוגי", PriceIls = TestPurchase.Price, Status = ProductStatus.Published,
            ScenarioId = "couples-cipher", MinPlayers = 1, MaxPlayers = 2, SortOrder = 98, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        });
        try { await db.SaveChangesAsync(); } catch (DbUpdateException) { /* made by a parallel test */ }
    }

    private HubConnection NewConnection()
    {
        var server = factory.Server;
        return new HubConnectionBuilder().WithUrl(new Uri(server.BaseAddress, "/hubs/game"), o =>
        {
            o.Transports = HttpTransportType.LongPolling;
            o.HttpMessageHandlerFactory = _ => server.CreateHandler();
        }).Build();
    }

    private async Task ConnectAsync(Seat s)
    {
        s.Conn.On<JsonElement>("letter", e => s.Letters.Enqueue(e));
        s.Conn.On<JsonElement>("letter-opened", e => s.Opened.Enqueue(e));
        await s.Conn.StartAsync();
        var r = await s.Conn.InvokeAsync<JsonElement>("Connect", s.Token);
        Assert.True(r.GetProperty("ok").GetBoolean(), r.ToString());
        s.PlayerId = r.GetProperty("data").GetProperty("playerId").GetString()!;
    }

    private async Task<Seat> JoinAsync(HttpClient http, string code, string nickname, string character, string? hostClaim = null)
    {
        var res = await http.PostAsJsonAsync($"/api/rooms/{code}/players", new { nickname, characterId = character, appearance = "{}", hostClaim });
        var body = await res.Content.ReadFromJsonAsync<JsonElement>(Json);
        Assert.True(res.IsSuccessStatusCode, body.ToString());
        var s = new Seat { Conn = NewConnection(), Token = body.GetProperty("token").GetString()! };
        await ConnectAsync(s);
        return s;
    }

    /// <summary>A paid "הצופן הזוגי" game with one or two players, already playing.</summary>
    private async Task<List<Seat>> GameAsync(int players, string productId = ProductId, bool lettersOpen = true)
    {
        await EnsureProductAsync();
        var http = factory.CreateClient();
        var (code, claim) = await TestPurchase.PaidRoomAsync(http, factory.Services, productId);
        var seats = new List<Seat> { await JoinAsync(http, code, "רוני", "explorer", claim) };
        if (players > 1) seats.Add(await JoinAsync(http, code, "נועה", "scholar"));
        foreach (var s in seats.Skip(1)) await Ok(s, "SetReady", true);
        await Ok(seats[0], "StartGame");
        await Ok(seats[0], "FinishIntro", true);
        lastCode = code;
        if (lettersOpen) await OpenLettersAsync(code);
        return seats;
    }

    private string lastCode = "";

    /// <summary>Letters open after the letter room's first puzzle: here it is simply marked solved.</summary>
    private async Task OpenLettersAsync(string code)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
        var room = await db.Rooms.Include(r => r.Puzzles).FirstAsync(r => r.Code == code);
        var p = room.Puzzles.FirstOrDefault(x => x.PuzzleId == "cc5-order");
        if (p == null) return; // another game: it has no letter room
        p.Status = PuzzleStatus.Solved;
        p.SolvedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task A_letter_waits_for_the_first_letter_room_puzzle_and_holds_twenty_words()
    {
        var seats = await GameAsync(2, lettersOpen: false);
        Assert.Equal("not-yet", Code(await Call(seats[0], "SendLetter", "letter-w-0001", "תודה", false)));
        await OpenLettersAsync(lastCode);
        var long21 = string.Join(" ", Enumerable.Range(1, 21).Select(i => "מילה" + i));
        Assert.Equal("too-long", Code(await Call(seats[0], "SendLetter", "letter-w-0002", long21, false)));
        var twenty = string.Join(" ", Enumerable.Range(1, 20).Select(i => "מילה" + i));
        Assert.True((await Ok(seats[0], "SendLetter", "letter-w-0003", twenty, false)).GetProperty("ok").GetBoolean());
    }

    private static async Task<JsonElement> Call(Seat s, string method, params object?[] args) =>
        await s.Conn.InvokeCoreAsync<JsonElement>(method, args);

    private static async Task<JsonElement> Ok(Seat s, string method, params object?[] args)
    {
        var r = await Call(s, method, args);
        Assert.True(r.GetProperty("ok").GetBoolean(), method + ": " + r);
        return r;
    }

    private static async Task WaitFor(Func<bool> cond, string what)
    {
        for (var i = 0; i < 100 && !cond(); i++) await Task.Delay(50);
        Assert.True(cond(), "Timed out waiting for " + what);
    }

    private static string Code(JsonElement r) => r.GetProperty("code").GetString()!;

    private T Db<T>(Func<PortalDbContext, T> read)
    {
        using var scope = factory.Services.CreateScope();
        return read(scope.ServiceProvider.GetRequiredService<PortalDbContext>());
    }

    [Fact]
    public async Task A_letter_is_saved_then_reaches_only_the_partner_who_opens_it_once()
    {
        var seats = await GameAsync(2);
        var (a, b) = (seats[0], seats[1]);
        const string text = "נועה,\nתודה על כל יום.\n— רוני";
        var sent = await Ok(a, "SendLetter", "letter-a-0001", text, false);
        Assert.True(sent.GetProperty("data").GetProperty("hasRecipient").GetBoolean());

        // the envelope reaches the partner, without the text; the writer gets no envelope of their own
        await WaitFor(() => b.Letters.Count == 1, "the envelope");
        Assert.False(b.Letters.First().TryGetProperty("text", out _));
        Assert.Empty(a.Letters);

        // a double click is one letter; a second, different letter in the same round is refused
        Assert.Equal("duplicate", Code(await Ok(a, "SendLetter", "letter-a-0001", text, false)));
        Assert.Equal("already-sent", Code(await Call(a, "SendLetter", "letter-a-0002", "שוב", false)));
        await Task.Delay(200);
        Assert.Single(b.Letters);

        // only the recipient reads the text; the writer sees only its status, never their own text in its place
        var inbox = (await Ok(b, "GetMyLetters")).GetProperty("data");
        Assert.Equal(text, inbox.GetProperty("inbox")[0].GetProperty("text").GetString());
        Assert.Equal("רוני", inbox.GetProperty("inbox")[0].GetProperty("from").GetString());
        var mine = (await Ok(a, "GetMyLetters")).GetProperty("data");
        Assert.Equal(0, mine.GetProperty("inbox").GetArrayLength());
        Assert.DoesNotContain("תודה על כל יום", mine.ToString());

        // opened: the writer is told (no text), and opening again is fine
        var id = inbox.GetProperty("inbox")[0].GetProperty("id").GetString()!;
        await Ok(b, "OpenLetter", id);
        await WaitFor(() => a.Opened.Count == 1, "the opened notice");
        await Ok(b, "OpenLetter", id);
        var row = Db(db => db.PersonalLetters.AsNoTracking().Single(l => l.Id == Guid.Parse(id)));
        Assert.NotNull(row.DeliveredAt);
        Assert.NotNull(row.OpenedAt);

        // both ways: the partner writes back, and each one has exactly their own letter
        await Ok(b, "SendLetter", "letter-b-0001", "גם לך, רוני.", false);
        await WaitFor(() => a.Letters.Count == 1, "the second envelope");
        var back = (await Ok(a, "GetMyLetters")).GetProperty("data").GetProperty("inbox");
        Assert.Equal("גם לך, רוני.", back[0].GetProperty("text").GetString());
        foreach (var s in seats) await s.DisposeAsync();
    }

    [Fact]
    public async Task A_letter_sent_while_the_partner_is_away_waits_for_them()
    {
        var seats = await GameAsync(2);
        var (a, b) = (seats[0], seats[1]);
        await b.Conn.DisposeAsync();
        await Ok(a, "SendLetter", "letter-away-01", "חיכיתי לך.", false);

        // back on a new connection: the letter is there, unopened, although its live envelope was missed
        b.Conn = NewConnection();
        await ConnectAsync(b);
        var inbox = (await Ok(b, "GetMyLetters")).GetProperty("data").GetProperty("inbox");
        Assert.Equal(1, inbox.GetArrayLength());
        Assert.Equal("חיכיתי לך.", inbox[0].GetProperty("text").GetString());
        Assert.Equal(JsonValueKind.Null, inbox[0].TryGetProperty("openedAt", out var o) ? o.ValueKind : JsonValueKind.Null);
        foreach (var s in seats) await s.DisposeAsync();
    }

    [Fact]
    public async Task Nobody_else_can_read_or_open_a_letter_and_the_text_is_sealed_and_never_logged()
    {
        var game1 = await GameAsync(2);
        var game2 = await GameAsync(2);
        const string secret = "מילים שרק לך";
        await Ok(game1[0], "SendLetter", "letter-priv-01", secret, false);
        var id = (await Ok(game1[1], "GetMyLetters")).GetProperty("data").GetProperty("inbox")[0].GetProperty("id").GetString()!;

        // a player of another game: nothing in their letters, and opening someone else's letter fails
        Assert.Equal(0, (await Ok(game2[0], "GetMyLetters")).GetProperty("data").GetProperty("inbox").GetArrayLength());
        Assert.Equal("not-found", Code(await Call(game2[0], "OpenLetter", id)));
        // the writer cannot open their own sent letter as if it were theirs
        Assert.Equal("not-found", Code(await Call(game1[0], "OpenLetter", id)));

        var row = Db(db => db.PersonalLetters.AsNoTracking().Single(l => l.Id == Guid.Parse(id)));
        Assert.StartsWith("v1.", row.BodySealed);
        Assert.DoesNotContain(secret, row.BodySealed);
        // the event log columns are jsonb: read this room's log and look for the text in memory
        var log = Db(db => db.Events.AsNoTracking().Where(e => e.RoomId == row.RoomId).Select(e => new { e.PayloadJson, e.ResultJson }).ToList());
        Assert.DoesNotContain(log, e => (e.PayloadJson ?? "").Contains(secret) || (e.ResultJson ?? "").Contains(secret));
        foreach (var s in game1.Concat(game2)) await s.DisposeAsync();
    }

    [Fact]
    public async Task Empty_and_too_long_letters_are_refused_and_nothing_is_saved()
    {
        var seats = await GameAsync(2);
        Assert.Equal("empty", Code(await Call(seats[0], "SendLetter", "letter-empty-1", "  \n\t ", false)));
        Assert.Equal("too-long", Code(await Call(seats[0], "SendLetter", "letter-long-01", new string('א', 4001), false)));
        Assert.Equal("bad-id", Code(await Call(seats[0], "SendLetter", "x", "שלום", false)));
        var pid = Guid.Parse(seats[0].PlayerId);
        Assert.False(Db(db => db.PersonalLetters.Any(l => l.SenderPlayerId == pid)));
        foreach (var s in seats) await s.DisposeAsync();
    }

    [Fact]
    public async Task Alone_a_letter_is_kept_only_when_chosen_and_never_arrives_as_if_from_someone()
    {
        var seats = await GameAsync(1);
        var me = seats[0];
        Assert.Equal("no-partner", Code(await Call(me, "SendLetter", "letter-solo-01", "לעצמי", false)));
        await Ok(me, "SendLetter", "letter-solo-01", "לעצמי", true);
        var view = (await Ok(me, "GetMyLetters")).GetProperty("data");
        Assert.True(view.GetProperty("solo").GetBoolean());
        Assert.Equal(0, view.GetProperty("inbox").GetArrayLength());
        Assert.Equal("לעצמי", view.GetProperty("kept").GetProperty("text").GetString());
        await Task.Delay(200);
        Assert.Empty(me.Letters);
        await me.DisposeAsync();
    }

    [Fact]
    public async Task Other_games_have_no_letters()
    {
        var seats = await GameAsync(2, TestPurchase.ProductId);
        Assert.Equal("not-allowed", Code(await Call(seats[0], "SendLetter", "letter-other-1", "שלום", false)));
        Assert.Equal("not-allowed", Code(await Call(seats[0], "GetMyLetters")));
        foreach (var s in seats) await s.DisposeAsync();
    }
}
