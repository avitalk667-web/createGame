using System.Text.Json;
using PortalX.Server.Content;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>The dreidel room's preparation before the original stand: the spinning dreidel, the memory, the four corners.</summary>
public static class DreidelChain
{
    public static void Open(GameEngine e, GameRoom r, Guid player, DateTime t)
    {
        for (var i = 0; i < 4; i++)
            Assert.True(e.Operate(r, player, "h5-spin", J(new { op = "spin" }), t.AddSeconds(3.1 * i)).Ok);
        Assert.Equal("solved", e.SubmitAnswer(r, player, "h5-memory", J("נגהפ"), t).Code);
        Assert.Equal("solved", e.SubmitAnswer(r, player, "h5-corners", J("bl"), t).Code);
    }

    public const int Points = 0 + 10 + 15;
}

public class DreidelRoomTests
{
    private static readonly DateTime T0 = new(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc);
    private static ScenarioContent Content => Catalog.Get("hanukkah-oil");

    /// <summary>A game whose group stands in the dreidel room (rooms 1–4 played by the first player).</summary>
    private static (GameEngine e, GameRoom r, List<PlayerSession> ps) InDreidels(int players)
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("hanukkah-oil", "DRD234", "hash", T0);
        var ps = new List<PlayerSession>();
        for (var i = 0; i < players; i++)
        {
            Assert.True(e.AddPlayer(r, "שחקן" + i, GameEngine.Characters[i % 4], "{}", "t" + i, i == 0, T0, out var p).Ok);
            p!.IsConnected = true;
            ps.Add(p);
        }
        foreach (var p in ps.Skip(1)) e.SetReady(r, p.Id, true);
        Assert.True(e.StartGame(r, ps[0].Id, T0).Ok);
        Assert.True(e.FinishIntro(r, ps[0].Id, true, T0).Ok);
        var me = ps[0].Id;
        LibraryChain.Open(e, r, me, T0);
        Assert.Equal("solved", e.SubmitAnswer(r, me, "h1-riddle", J("פך השמן"), T0).Code);
        WorkshopChain.Open(e, r, me, T0);
        string[] order = ["lamp-base", "lamp-tank", "lamp-wick", "lamp-glass", "lamp-cover"];
        foreach (var part in order) Assert.True(e.PickUp(r, me, part, T0).Ok);
        for (var i = 0; i < 5; i++) e.Operate(r, me, "h2-lamp", J(new { op = "place", slot = $"s{i + 1}", item = order[i] }), T0);
        var t = T0;
        void Go(string dirs) { foreach (var d in dirs) e.Operate(r, me, "h3-maze", J(new { op = "move", dir = d.ToString() }), t = t.AddMilliseconds(300)); }
        void Lever(int i) => e.Operate(r, me, "h3-maze", J(new { op = "lever", index = i }), t);
        Go("EE"); Lever(0); Go("EEEESSW"); Lever(1); Go("WWWSS"); Lever(2); Go("EEEE");
        Assert.Equal("solved", e.SubmitAnswer(r, me, "h3-box", J("825"), T0).Code);
        CipherChain.Open(e, r, me, T0);
        Assert.Equal("solved", e.SubmitAnswer(r, me, "h4-wheel", J("אור"), T0).Code);
        Assert.True(e.Continue(r, me, T0).Ok);
        return (e, r, ps);
    }

    private static ActionOutcome Spin(GameEngine e, GameRoom r, PlayerSession p, DateTime at) => e.Operate(r, p.Id, "h5-spin", J(new { op = "spin" }), at);
    private static PuzzleStatus Status(GameRoom r, string id) => r.Puzzles.First(p => p.PuzzleId == id).Status;
    private static WorldState W(GameRoom r) => GameEngine.World(r);
    private static int Personal(GameRoom r, PlayerSession p) => W(r).Score!.Personal.GetValueOrDefault(p.Id.ToString());

    [Fact]
    public void The_dreidel_stops_on_the_same_four_letters_for_everyone_and_waits_between_spins()
    {
        var (e, r, ps) = InDreidels(4);
        var letters = new List<string> { Spin(e, r, ps[0], T0).Message };
        // another player cannot spin it again while it is still showing its letter
        Assert.Equal("spinning", Spin(e, r, ps[1], T0.AddSeconds(1)).Code);
        letters.Add(Spin(e, r, ps[1], T0.AddSeconds(3.1)).Message);
        letters.Add(Spin(e, r, ps[2], T0.AddSeconds(6.2)).Message);
        Assert.Equal(PuzzleStatus.Active, Status(r, "h5-spin"));
        var last = Spin(e, r, ps[3], T0.AddSeconds(9.3));
        Assert.Equal("solved", last.Code);
        Assert.Contains(last.Notices, n => n.Message.EndsWith("פ"));
        Assert.Equal(["נ", "ג", "ה"], letters);
        Assert.Equal(4, W(r).Mechanisms["h5-spin"].Progress);   // the shared state every client draws from
        Assert.Equal(PuzzleStatus.Active, Status(r, "h5-memory"));
    }

    [Fact]
    public void Memory_and_corners_open_the_original_stand_whose_code_is_still_4826()
    {
        var (e, r, ps) = InDreidels(1);
        var p = ps[0];
        foreach (var id in new[] { "h5-memory", "h5-corners", "h5-stand", "h5-lock" }) Assert.Equal(PuzzleStatus.Locked, Status(r, id));
        Assert.Equal("locked", e.DiscoverClue(r, p.Id, "r5-card-1", T0).Code);   // the hint cards come with the right corner
        for (var i = 0; i < 4; i++) Assert.True(Spin(e, r, p, T0.AddSeconds(3.1 * i)).Ok);

        Assert.Equal("wrong", e.SubmitAnswer(r, p.Id, "h5-memory", J("נגפה"), T0).Code);
        Assert.Equal("solved", e.SubmitAnswer(r, p.Id, "h5-memory", J("נגהפ"), T0).Code);
        Assert.Equal("wrong", e.SubmitAnswer(r, p.Id, "h5-corners", J("tr"), T0).Code);
        Assert.Equal("locked", e.DiscoverClue(r, p.Id, "r5-card-2", T0).Code);
        Assert.Equal("solved", e.SubmitAnswer(r, p.Id, "h5-corners", J("bl"), T0).Code);
        foreach (var card in new[] { "r5-card-1", "r5-card-2", "r5-card-3", "r5-card-4" }) Assert.True(e.DiscoverClue(r, p.Id, card, T0).Ok);
        Assert.Equal(PuzzleStatus.Active, Status(r, "h5-stand"));

        // the original stand: נ top-left, ג top-right, פ bottom-left, ה bottom-right — and the code 4826
        foreach (var d in new[] { "dreidel-nun", "dreidel-gimel", "dreidel-he", "dreidel-pe" }) Assert.True(e.PickUp(r, p.Id, d, T0).Ok);
        foreach (var (slot, item) in new[] { ("tl", "dreidel-nun"), ("tr", "dreidel-gimel"), ("bl", "dreidel-pe") })
            Assert.True(e.Operate(r, p.Id, "h5-stand", J(new { op = "place", slot, item }), T0).Ok);
        Assert.Equal("solved", e.Operate(r, p.Id, "h5-stand", J(new { op = "place", slot = "br", item = "dreidel-he" }), T0).Code);
        Assert.Equal("wrong", e.SubmitAnswer(r, p.Id, "h5-lock", J("1234"), T0).Code);
        Assert.Equal("solved", e.SubmitAnswer(r, p.Id, "h5-lock", J("4826"), T0).Code);
        Assert.Contains("flame-symbol", W(r).Inventory);
    }

    [Fact]
    public void The_corner_matches_the_stand_without_giving_its_arrangement_away()
    {
        var spin = Content.Puzzle("h5-spin").PublicData["sequence"]!.AsArray().Select(n => n!.GetValue<string>()).ToList();
        Assert.Equal(["נ", "ג", "ה", "פ"], spin);
        Assert.Equal(string.Concat(spin), Content.Puzzle("h5-memory").Solution["text"]!.GetValue<string>());
        var corners = Content.Puzzle("h5-corners").PublicData["corners"]!.AsArray()
            .ToDictionary(c => c!["id"]!.GetValue<string>(), c => c!["letter"]!.GetValue<string>());
        var answer = Content.Puzzle("h5-corners").Solution["text"]!.GetValue<string>();
        // the right corner holds the letter that closed the sequence, in the same place that letter has on the stand
        Assert.Equal(spin[^1], corners[answer]);
        var stand = Content.Puzzle("h5-stand").Solution["slots"]!.AsObject();
        Assert.Equal("dreidel-pe", stand[answer]!.GetValue<string>());
        // but the other corners are not the stand's arrangement
        var letterOf = new Dictionary<string, string> { ["dreidel-nun"] = "נ", ["dreidel-gimel"] = "ג", ["dreidel-he"] = "ה", ["dreidel-pe"] = "פ" };
        Assert.Contains(corners, kv => letterOf[stand[kv.Key]!.GetValue<string>()] != kv.Value);
        Assert.Equal("4826", Content.Puzzle("h5-lock").Solution["text"]!.GetValue<string>());
    }

    [Fact]
    public void Each_step_scores_once_for_the_player_who_did_it()
    {
        var (e, r, ps) = InDreidels(4);
        var b = ps.Select(p => Personal(r, p)).ToArray();
        for (var i = 0; i < 4; i++) Assert.True(Spin(e, r, ps[i], T0.AddSeconds(3.1 * i)).Ok);
        Assert.Equal(b, ps.Select(p => Personal(r, p)).ToArray());    // watching the dreidel gives no points
        Assert.Equal("solved", e.SubmitAnswer(r, ps[1].Id, "h5-memory", J("נגהפ"), T0).Code);
        Assert.Equal("solved", e.SubmitAnswer(r, ps[2].Id, "h5-corners", J("bl"), T0).Code);
        Assert.Equal(b[1] + 10, Personal(r, ps[1]));
        Assert.Equal(b[2] + 15, Personal(r, ps[2]));
        Assert.Equal(W(r).Score!.Log.Count, W(r).Score!.Log.Select(x => x.Key).Distinct().Count());
    }

    private static readonly string[] NewSteps = ["h5-spin", "h5-memory", "h5-corners"];

    [Fact]
    public void An_old_game_already_at_the_stand_keeps_its_cards_and_carries_on()
    {
        var (e, r, ps) = InDreidels(2);
        DreidelChain.Open(e, r, ps[0].Id, T0);
        Assert.True(e.DiscoverClue(r, ps[1].Id, "r5-card-1", T0).Ok);
        r.Puzzles.RemoveAll(p => NewSteps.Contains(p.PuzzleId));
        var w = W(r);
        w.Mechanisms.Remove("h5-spin");
        r.WorldJson = JsonSerializer.Serialize(w, ScenarioCatalog.JsonOptions);
        var before = r.WorldJson;
        e.FillMissingPuzzles(r);
        foreach (var id in NewSteps) Assert.Equal(PuzzleStatus.Solved, Status(r, id));
        Assert.Equal(before, r.WorldJson);
        Assert.Equal(PuzzleStatus.Active, Status(r, "h5-stand"));
        Assert.True(e.DiscoverClue(r, ps[1].Id, "r5-card-2", T0).Ok);
    }

    [Fact]
    public void Four_players_and_a_single_player_both_reach_the_lab()
    {
        foreach (var n in new[] { 1, 4 })
        {
            var (e, r, ps) = InDreidels(n);
            DreidelChain.Open(e, r, ps[n - 1].Id, T0);
            foreach (var d in new[] { "dreidel-nun", "dreidel-gimel", "dreidel-he", "dreidel-pe" }) Assert.True(e.PickUp(r, ps[0].Id, d, T0).Ok);
            foreach (var (slot, item) in new[] { ("tl", "dreidel-nun"), ("tr", "dreidel-gimel"), ("bl", "dreidel-pe"), ("br", "dreidel-he") })
                e.Operate(r, ps[0].Id, "h5-stand", J(new { op = "place", slot, item }), T0);
            Assert.Equal("solved", e.SubmitAnswer(r, ps[0].Id, "h5-lock", J("4826"), T0).Code);
            Assert.Equal("lab", W(r).PendingZone);
        }
    }
}
