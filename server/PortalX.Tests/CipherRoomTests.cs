using System.Text.Json;
using PortalX.Server.Content;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>The cipher room's preparation before the original letter wheel: the missing number and the mirror writing.</summary>
public static class CipherChain
{
    public static void Open(GameEngine e, GameRoom r, Guid player, DateTime t)
    {
        Assert.Equal("solved", e.SubmitAnswer(r, player, "h4-sequence", J("32"), t).Code);
        Assert.True(e.PickUp(r, player, "mirror-scroll", t).Ok);   // the clue box opened on it
        Assert.Equal("solved", e.Operate(r, player, "h4-mirror", J(new { op = "place", slot = "mirror", item = "mirror-scroll" }), t).Code);
    }

    public const int Points = 10 + 10 + 15;   // the series, picking up the scroll, the mirror
}

public class CipherRoomTests
{
    private static readonly DateTime T0 = new(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc);
    private static ScenarioContent Content => Catalog.Get("hanukkah-oil");

    /// <summary>A game whose group stands in the cipher room (rooms 1–3 played by the first player).</summary>
    private static (GameEngine e, GameRoom r, List<PlayerSession> ps) InCipher(int players)
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("hanukkah-oil", "CIP234", "hash", T0);
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
        // the maze route, then the box
        var t = T0;
        void Go(string dirs) { foreach (var d in dirs) e.Operate(r, me, "h3-maze", J(new { op = "move", dir = d.ToString() }), t = t.AddMilliseconds(300)); }
        void Lever(int i) => e.Operate(r, me, "h3-maze", J(new { op = "lever", index = i }), t);
        Go("EE"); Lever(0); Go("EEEESSW"); Lever(1); Go("WWWSS"); Lever(2); Go("EEEE");
        Assert.Equal("solved", e.SubmitAnswer(r, me, "h3-box", J("825"), T0).Code);
        Assert.True(e.Continue(r, me, T0).Ok);
        return (e, r, ps);
    }

    private static PuzzleStatus Status(GameRoom r, string id) => r.Puzzles.First(p => p.PuzzleId == id).Status;
    private static WorldState W(GameRoom r) => GameEngine.World(r);
    private static int Personal(GameRoom r, PlayerSession p) => W(r).Score!.Personal.GetValueOrDefault(p.Id.ToString());

    [Fact]
    public void The_series_and_the_mirror_open_the_original_wheel_whose_answer_is_still_light()
    {
        var (e, r, ps) = InCipher(1);
        var p = ps[0];
        Assert.Equal(PuzzleStatus.Active, Status(r, "h4-sequence"));
        Assert.Equal(PuzzleStatus.Locked, Status(r, "h4-mirror"));
        Assert.Equal(PuzzleStatus.Locked, Status(r, "h4-wheel"));
        Assert.Equal("locked", e.DiscoverClue(r, p.Id, "r4-gematria", T0).Code);   // the gematria board appears with the mirror

        Assert.Equal("wrong", e.SubmitAnswer(r, p.Id, "h4-sequence", J("24"), T0).Code);
        Assert.Equal("solved", e.SubmitAnswer(r, p.Id, "h4-sequence", J("32"), T0).Code);
        Assert.Contains("mirror-scroll", W(r).WorldItems);                         // the clue box opened on the scroll
        Assert.True(e.PickUp(r, p.Id, "mirror-scroll", T0).Ok);
        Assert.Equal(PuzzleStatus.Active, Status(r, "h4-mirror"));

        Assert.Equal("solved", e.Operate(r, p.Id, "h4-mirror", J(new { op = "place", slot = "mirror", item = "mirror-scroll" }), T0).Code);
        Assert.Equal(PuzzleStatus.Active, Status(r, "h4-wheel"));
        Assert.True(e.DiscoverClue(r, p.Id, "r4-gematria", T0).Ok);

        Assert.Equal("wrong", e.SubmitAnswer(r, p.Id, "h4-wheel", J("רוא"), T0).Code);
        Assert.Equal("solved", e.SubmitAnswer(r, p.Id, "h4-wheel", J("אור"), T0).Code);
        Assert.Contains("light-stone", W(r).Inventory);
        Assert.Contains("dreidels", e.UnlockedZones(r, Content));
    }

    [Fact]
    public void Each_step_scores_once_for_the_player_who_did_it()
    {
        var (e, r, ps) = InCipher(4);
        var b = ps.Select(p => Personal(r, p)).ToArray();
        Assert.Equal("wrong", e.SubmitAnswer(r, ps[2].Id, "h4-sequence", J("30"), T0).Code);
        Assert.Equal("solved", e.SubmitAnswer(r, ps[1].Id, "h4-sequence", J("32"), T0).Code);
        Assert.Equal("already-solved", e.SubmitAnswer(r, ps[3].Id, "h4-sequence", J("32"), T0).Code);
        Assert.Equal(b[1] + 10, Personal(r, ps[1]));
        Assert.True(e.PickUp(r, ps[2].Id, "mirror-scroll", T0).Ok);
        Assert.Equal(b[2] + 10, Personal(r, ps[2]));          // finding it scores like any important item

        Assert.Equal("solved", e.Operate(r, ps[3].Id, "h4-mirror", J(new { op = "place", slot = "mirror", item = "mirror-scroll" }), T0).Code);
        Assert.Equal(b[3] + 15, Personal(r, ps[3]));
        Assert.Equal(W(r).Score!.Log.Count, W(r).Score!.Log.Select(x => x.Key).Distinct().Count());
    }

    [Fact]
    public void The_series_doubles_to_32_and_the_wheel_keeps_its_numbers()
    {
        var nums = Content.Puzzle("h4-sequence").PublicData["numbers"]!.AsArray().Select(n => n!.GetValue<int>()).ToArray();
        Assert.Equal([2, 4, 8, 16], nums);
        Assert.All(nums.Skip(1).Select((n, i) => (n, prev: nums[i])), x => Assert.Equal(x.prev * 2, x.n));
        Assert.Equal((nums[^1] * 2).ToString(), Content.Puzzle("h4-sequence").Solution["text"]!.GetValue<string>());
        Assert.Equal("לא כל מספר הוא מספר. חפשו את האות שמסתתרת בו.", Content.Puzzle("h4-mirror").PublicData["message"]!.GetValue<string>());
        Assert.Equal([1, 6, 200], Content.Puzzle("h4-wheel").PublicData["numbers"]!.AsArray().Select(n => n!.GetValue<int>()));
        Assert.Equal("אור", Content.Puzzle("h4-wheel").Solution["text"]!.GetValue<string>());
    }

    [Fact]
    public void Four_players_and_a_single_player_both_reach_the_dreidel_room()
    {
        foreach (var n in new[] { 1, 4 })
        {
            var (e, r, ps) = InCipher(n);
            CipherChain.Open(e, r, ps[n - 1].Id, T0);
            Assert.Equal("solved", e.SubmitAnswer(r, ps[0].Id, "h4-wheel", J("אור"), T0).Code);
            Assert.Equal("dreidels", W(r).PendingZone);
        }
    }

    private static readonly string[] NewSteps = ["h4-sequence", "h4-mirror"];

    [Fact]
    public void An_old_game_already_at_the_wheel_carries_on_unchanged()
    {
        var (e, r, ps) = InCipher(2);
        CipherChain.Open(e, r, ps[0].Id, T0);
        r.Puzzles.RemoveAll(p => NewSteps.Contains(p.PuzzleId));
        var w = W(r);
        w.Mechanisms.Remove("h4-mirror");
        w.Inventory.Remove("mirror-scroll");
        r.WorldJson = JsonSerializer.Serialize(w, ScenarioCatalog.JsonOptions);
        var before = r.WorldJson;
        e.FillMissingPuzzles(r);
        foreach (var id in NewSteps) Assert.Equal(PuzzleStatus.Solved, Status(r, id));
        Assert.Equal(before, r.WorldJson);
        Assert.Equal(PuzzleStatus.Active, Status(r, "h4-wheel"));
        Assert.True(e.DiscoverClue(r, ps[1].Id, "r4-gematria", T0).Ok);
        Assert.Equal("solved", e.SubmitAnswer(r, ps[1].Id, "h4-wheel", J("אור"), T0).Code);
    }

    [Fact]
    public void An_old_game_still_before_the_cipher_room_meets_the_new_steps_there()
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("hanukkah-oil", "OLC234", "hash", T0);
        Assert.True(e.AddPlayer(r, "ותיק", "explorer", "{}", "t0", true, T0, out var p).Ok);
        p!.IsConnected = true;
        Assert.True(e.StartGame(r, p.Id, T0).Ok);
        Assert.True(e.FinishIntro(r, p.Id, true, T0).Ok);
        r.Puzzles.RemoveAll(x => NewSteps.Contains(x.PuzzleId));
        var w = W(r);
        w.Mechanisms.Remove("h4-mirror");
        r.WorldJson = JsonSerializer.Serialize(w, ScenarioCatalog.JsonOptions);
        e.FillMissingPuzzles(r);
        foreach (var id in NewSteps) Assert.Equal(PuzzleStatus.Locked, Status(r, id));
        Assert.Equal(PuzzleStatus.Locked, Status(r, "h4-wheel"));
        Assert.Empty(W(r).Score!.Log);
    }
}
