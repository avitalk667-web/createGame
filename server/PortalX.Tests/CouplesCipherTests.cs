using System.Text.Json;
using System.Text.Json.Nodes;
using PortalX.Server.Content;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>
/// "הצופן הזוגי": five rooms for one or two players. Every puzzle is solvable alone; the swaying bridge is the one puzzle
/// built for two hands (a single player uses the latches). Every reward is a real part of the house, the house is checked
/// stage by stage without saying which part is wrong, and the scoring is the site's usual personal + group scoring.
/// </summary>
public class CouplesCipherTests
{
    private static readonly DateTime T0 = new(2026, 12, 20, 19, 0, 0, DateTimeKind.Utc);
    private static ScenarioContent Cc => Catalog.Get("couples-cipher");

    public sealed record Game(GameEngine E, GameRoom R, List<PlayerSession> Ps)
    {
        public ActionOutcome Op(int who, string puzzle, object action, DateTime? at = null) => E.Operate(R, Ps[who % Ps.Count].Id, puzzle, J(action), at ?? T0);
        public ActionOutcome Answer(int who, string puzzle, string text, DateTime? at = null) => E.SubmitAnswer(R, Ps[who % Ps.Count].Id, puzzle, J(text), at ?? T0);
        public WorldState World => GameEngine.World(R);
        public PuzzleStatus Status(string id) => R.Puzzles.First(p => p.PuzzleId == id).Status;
        public MechanismState Mech(string id) => World.Mechanisms[id];
        public void Continue() => Assert.True(E.Continue(R, Ps[0].Id, T0).Ok);
    }

    public static Game Start(int players, string code = "COUPLE")
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("couples-cipher", code, "hash", T0);
        var ps = new List<PlayerSession>();
        for (var i = 0; i < players; i++)
        {
            Assert.True(e.AddPlayer(r, "שחקן" + i, GameEngine.Characters[i], "{}", "c" + i + code, i == 0, T0, out var p).Ok);
            p!.IsConnected = true;
            ps.Add(p);
        }
        for (var i = 1; i < players; i++) e.SetReady(r, ps[i].Id, true);
        Assert.True(e.StartGame(r, ps[0].Id, T0).Ok);
        Assert.True(e.FinishIntro(r, ps[0].Id, true, T0).Ok);
        return new Game(e, r, ps);
    }

    // ------------------------------------------------------------------ the rooms, one by one

    public static void Sounds(Game g)
    {
        Assert.Equal("solved", g.Answer(0, "cc1-listen", "1368").Code);
        // hour hand from the bell (4) back three to the leaf (1); minute hand from the star (6) on three to the leaf
        for (var i = 0; i < 3; i++) Assert.True(g.Op(0, "cc1-clock", new { op = "turn", hand = 0, dir = -1 }).Ok);
        for (var i = 0; i < 3; i++) Assert.True(g.Op(1, "cc1-clock", new { op = "turn", hand = 1, dir = 1 }).Ok);
        Assert.Equal("solved", g.Op(1, "cc1-clock", new { op = "press" }).Code);
        // "הצליל החסר" is retired: the clock gives the brass stone and opens the next room
        Assert.Contains("cc-foundation-stone", g.World.Inventory);
        Assert.DoesNotContain(Cc.Puzzles, p => p.Id == "cc1-missing");
        g.Continue();
    }

    /// <summary>The one way through the track that passes both lamps: cell → its turn (row × 6 + column).</summary>
    public static readonly Dictionary<string, int> Track = new()
    {
        ["1,0"] = 3, ["0,0"] = 1, ["0,1"] = 2, ["1,1"] = 0, ["1,2"] = 2, ["2,2"] = 0, ["2,3"] = 3,
        ["1,3"] = 1, ["1,4"] = 0, ["1,5"] = 2, ["2,5"] = 3, ["2,4"] = 1, ["3,4"] = 0, ["3,5"] = 0,
    };

    public static void LayTrack(Game g, Dictionary<string, int> way)
    {
        var tiles = Cc.Puzzle("cc2-track").PublicData["tiles"]!.AsArray().Select(n => n!.GetValue<string>()).ToList();
        var k = 0;
        foreach (var (cell, want) in way)
        {
            var rc = cell.Split(',').Select(int.Parse).ToArray();
            var i = rc[0] * 6 + rc[1];
            var kind = tiles[rc[0]][rc[1]];
            while (g.Mech("cc2-track").Rotations[i] % (kind == 'S' ? 2 : 4) != want % (kind == 'S' ? 2 : 4))
                Assert.True(g.Op(k++, "cc2-track", new { op = "rotate", index = i }).Ok);
        }
    }

    public static void Partnership(Game g)
    {
        foreach (var (slot, item) in new[] { ("g1", "cc-gear-r3-24"), ("g2", "cc-gear-r1-8"), ("g3", "cc-gear-r2-16") })
            Assert.True(g.Op(0, "cc2-gears", new { op = "place", slot, item }).Ok);
        Assert.Equal("solved", g.Op(1, "cc2-gears", new { op = "activate" }).Code);
        LayTrack(g, Track);
        Assert.True(g.Op(0, "cc2-track", new { op = "valve", id = "drain" }).Ok);
        Assert.Equal("solved", g.Op(1, "cc2-track", new { op = "valve", id = "main" }).Code);
        g.Continue();
    }

    public static void Trust(Game g)
    {
        Assert.True(g.Op(0, "cc3-key", new { op = "place", slot = "lock", item = "cc-key-6" }).Ok);
        Assert.Equal("solved", g.Op(0, "cc3-key", new { op = "activate" }).Code);
        Assert.Equal("solved", g.Answer(1, "cc3-documents", "357").Code);
        Assert.Equal("solved", g.Answer(0, "cc3-safe-a", "267").Code);
        Assert.Equal("solved", g.Answer(1, "cc3-safe-b", "345").Code);
        Assert.Equal("solved", g.Answer(0, "cc3-safe-c", "7624").Code);
        g.Continue();
    }

    public static readonly (string Slot, string Item)[] Events =
        [("e1", "cc-letter-s5"), ("e2", "cc-letter-s2"), ("e3", "cc-letter-s8"), ("e4", "cc-letter-s1"),
         ("e5", "cc-letter-s6"), ("e6", "cc-letter-s3"), ("e7", "cc-letter-s7"), ("e8", "cc-letter-s4")];

    public static void Letters(Game g)
    {
        foreach (var (slot, item) in Events) Assert.True(g.Op(0, "cc5-order", new { op = "place", slot, item }).Ok);
        Assert.Equal("solved", g.Op(1, "cc5-order", new { op = "activate" }).Code);
        Assert.Equal("solved", g.Answer(0, "cc5-keywords", "11").Code);
        Assert.True(g.Op(1, "cc5-stamp", new { op = "place", slot = "box", item = "cc-stamp-d" }).Ok);
        Assert.Equal("solved", g.Op(1, "cc5-stamp", new { op = "activate" }).Code);
        g.Continue();
    }

    /// <summary>The last wall: each sign of the plan and the stone that belongs in it (the keepsakes carry both).</summary>
    public static readonly (string Place, string Stone)[] Wall =
        [("wave", "cc-stone-gear"), ("star", "cc-stone-home"), ("arch", "cc-stone-key"), ("flame", "cc-stone-letter"), ("leaf", "cc-stone-bell")];

    public static void Home(Game g, DateTime? at = null)
    {
        // stones in the wrong gap come out first, then every empty gap gets its stone
        foreach (var (slot, item) in Wall)
            if (g.Mech("cc6-wall").Slots.TryGetValue(slot, out var there) && there != item)
                Assert.True(g.Op(0, "cc6-wall", new { op = "remove", slot }, at).Ok);
        for (var k = 0; k < Wall.Length; k++)
        {
            var (slot, item) = Wall[k];
            if (g.Mech("cc6-wall").Slots.ContainsKey(slot)) continue;
            Assert.Equal("placed", g.Op(k % g.Ps.Count, "cc6-wall", new { op = "place", slot, item }, at).Code);
        }
        // nothing is judged while the stones go in: the check completes the wall (and the game)
        Assert.Equal("solved", g.Op(0, "cc6-wall", new { op = "activate" }, at).Code);
    }

    public static void PlayAll(Game g)
    {
        Sounds(g); Partnership(g); Trust(g); Letters(g); Home(g);
    }

    // ------------------------------------------------------------------ the content

    [Fact]
    public void Five_rooms_with_two_or_three_puzzles_each_and_the_house_at_the_end()
    {
        Assert.Equal(["cc-sounds", "cc-partnership", "cc-trust", "cc-letters", "cc-home"], Cc.Zones.OrderBy(z => z.Order).Select(z => z.Id).ToArray());
        Assert.Equal(1, Cc.MinPlayers);
        Assert.Equal(2, Cc.MaxPlayers);
        // the room shows only its element at the start — no inspirational text
        Assert.All(Cc.Zones, z => Assert.StartsWith("היסוד: ", z.Story));
        foreach (var z in Cc.Zones.Take(4))
        {
            // design puzzles: the three safes are one chain (puzzle 3 of the trust room)
            var count = Cc.Puzzles.Count(p => p.Zone == z.Id && !p.Id.StartsWith("cc3-safe-")) + (z.Id == "cc-trust" ? 1 : 0);
            Assert.InRange(count, 2, 3);
        }
        Assert.Equal(["cc6-wall"], Cc.Puzzles.Where(p => p.Zone == "cc-home").Select(p => p.Id).ToArray());
        // the swaying bridge is gone from room 2: the gears open the room, then the track
        Assert.DoesNotContain(Cc.Puzzles, p => p.Type == "bridge" || p.Id == "cc2-bridge");
        Assert.DoesNotContain(Cc.Clues, c => c.Id == "cc2-bridge-plate");
        Assert.Equal(["cc2-gears", "cc2-track"], Cc.Puzzles.Where(p => p.Zone == "cc-partnership").OrderBy(p => p.Order).Select(p => p.Id).ToArray());
        Assert.Null(Cc.Puzzle("cc2-gears").RequiresPuzzle);
        Assert.NotNull(Cc.Scoring);
    }

    [Fact]
    public void The_plans_room_is_gone_and_its_house_parts_come_from_the_other_rooms()
    {
        Assert.DoesNotContain(Cc.Zones, z => z.Id == "cc-plans");
        Assert.DoesNotContain(Cc.Puzzles, p => p.Zone == "cc-plans" || p.Id.StartsWith("cc4-") || p.UnlocksZone == "cc-plans");
        Assert.DoesNotContain(Cc.Clues, c => c.Zone == "cc-plans");
        Assert.DoesNotContain(Cc.Items, i => i.Zone == "cc-plans");
        // the trust room now opens the letters room, and the three parts it gave are earned in the trust and letters rooms
        Assert.Equal("cc-letters", Cc.Puzzle("cc3-safe-c").UnlocksZone);
        Assert.Equal("cc-roof-left", Cc.Puzzle("cc3-safe-b").RewardItem);
        Assert.Equal("cc-wall-garden", Cc.Puzzle("cc5-order").RewardItem);
        Assert.Equal("cc-wall-hidden", Cc.Puzzle("cc5-keywords").RewardItem);
        // the plan of the last wall hangs in the house room; the old house build is retired
        Assert.Contains(Cc.Clues, c => c.Id == "cc6-plan" && c.Zone == "cc-home");
        Assert.DoesNotContain(Cc.Puzzles, p => p.Id == "cc6-build");
        // the rooms are numbered 1–5 without a gap
        Assert.Equal([1, 2, 3, 4, 5], Cc.Zones.Select(z => z.Order).OrderBy(o => o).ToArray());
    }

    [Fact]
    public void Every_room_leaves_a_keepsake_that_ties_a_stone_to_a_place_in_the_last_wall()
    {
        var rewards = Cc.Puzzles.Where(p => p.RewardItem != null).Select(p => p.RewardItem!).ToList();
        Assert.Equal(7, rewards.Count);
        // every room before the house gives at least one keepsake
        Assert.All(Cc.Zones.Take(4), z => Assert.Contains(Cc.Puzzles, p => p.Zone == z.Id && p.RewardItem != null));
        // one keepsake per room carries the emblem of its stone and the sign of its place; the house itself is drawn on the plan
        var signs = new Dictionary<string, string> { ["wave"] = "גל", ["star"] = "כוכב", ["arch"] = "קשת", ["flame"] = "להבה", ["leaf"] = "עלה" };
        var keepsake = new Dictionary<string, string> { ["cc-stone-bell"] = "cc-foundation-stone", ["cc-stone-gear"] = "cc-heart-gear", ["cc-stone-key"] = "cc-door", ["cc-stone-letter"] = "cc-seal" };
        foreach (var (place, stone) in Wall)
        {
            Assert.Contains(stone, Cc.Items.Select(i => i.Id));
            if (!keepsake.TryGetValue(stone, out var k)) { Assert.Contains("בית קטן", Cc.Clues.First(c => c.Id == "cc6-plan").Text); continue; }
            Assert.Contains(k, rewards);
            Assert.Contains(signs[place], Cc.Items.First(i => i.Id == k).Description);
        }
    }

    // ------------------------------------------------------------------ the whole game

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public void The_whole_game_from_the_first_bell_to_the_house(int players)
    {
        var g = Start(players, "CCALL" + players);
        PlayAll(g);
        Assert.Equal(RoomPhase.Completed, g.R.Phase);
        Assert.All(g.R.Puzzles, p => Assert.Equal(PuzzleStatus.Solved, p.Status));
        // the keepsakes stay in the bag; the five stones are all in the wall
        Assert.Equal(5, g.Mech("cc6-wall").Slots.Count);
        Assert.DoesNotContain(g.World.WorldItems, i => i.StartsWith("cc-stone-"));
        var result = g.E.BuildResult(g.R);
        Assert.Equal(Cc.Puzzles.Count, result.PuzzlesTotal);
        Assert.Equal(result.PuzzlesTotal, result.PuzzlesSolved);
    }

    [Fact]
    public void Personal_and_group_scores_are_kept_in_the_saved_world_and_survive_a_reconnect()
    {
        var g = Start(2, "CCSCOR");
        Sounds(g);
        var board = g.World.Score!;
        // group: the room's points (easy = 100, no hints); personal: answers and the clock mechanism
        Assert.Equal(100, board.Rooms["cc-sounds"]);
        Assert.Equal(100, board.Group);
        Assert.Equal(25, board.Personal[g.Ps[0].Id.ToString()]);   // one answer: "הצליל החסר" is retired
        Assert.Equal(20, board.Personal[g.Ps[1].Id.ToString()]);
        // a hint costs the room's group points, as in the other games
        Assert.True(g.E.RequestHint(g.R, g.Ps[0].Id, "cc2-gears", T0).Ok);
        foreach (var (slot, item) in new[] { ("g1", "cc-gear-r3-24"), ("g2", "cc-gear-r1-8"), ("g3", "cc-gear-r2-16") })
            Assert.True(g.Op(1, "cc2-gears", new { op = "place", slot, item }).Ok);
        Assert.Equal("solved", g.Op(0, "cc2-gears", new { op = "activate" }).Code);
        // the score lives in the room's saved JSON: a disconnect and a reconnect read it back unchanged
        var saved = g.R.WorldJson;
        g.E.Disconnect(g.R, g.Ps[1].Id, "conn", T0);
        Assert.True(g.E.Reconnect(g.R, g.Ps[1].Id, "conn2", T0.AddSeconds(30)).Ok);
        Assert.Equal(saved, g.R.WorldJson);
        var reloaded = JsonSerializer.Deserialize<WorldState>(saved, ScenarioCatalog.JsonOptions)!.Score!;
        Assert.Equal(board.Group, reloaded.Group);
        Assert.Equal(g.World.Score!.Personal, reloaded.Personal);
    }

    [Fact]
    public void A_room_with_hints_gives_less_group_points()
    {
        var g = Start(1, "CCHINT");
        Assert.True(g.E.RequestHint(g.R, g.Ps[0].Id, "cc1-listen", T0).Ok);
        Assert.True(g.E.RequestHint(g.R, g.Ps[0].Id, "cc1-listen", T0).Ok);
        Sounds(g);
        Assert.Equal(100 - 2 * 10, g.World.Score!.Rooms["cc-sounds"]);
    }

    // ------------------------------------------------------------------ the clock

    [Fact]
    public void The_clock_checks_both_hands_and_other_compasses_are_unchanged()
    {
        var g = Start(1, "CCCLOK");
        Assert.Equal("solved", g.Answer(0, "cc1-listen", "1368").Code);
        Assert.Equal([4, 6], g.Mech("cc1-clock").Rotations.ToArray());
        // only the hour hand on the leaf: wrong
        for (var i = 0; i < 3; i++) g.Op(0, "cc1-clock", new { op = "turn", hand = 0, dir = -1 });
        Assert.Equal("wrong-answer", g.Op(0, "cc1-clock", new { op = "press" }).Code);
        Assert.False(g.Op(0, "cc1-clock", new { op = "turn", hand = 2 }).Ok);
        // wraps around: seven turns forward is one back
        for (var i = 0; i < 5; i++) g.Op(0, "cc1-clock", new { op = "turn", hand = 1, dir = 1 });
        Assert.Equal(3, g.Mech("cc1-clock").Rotations[1]);
        // the free game's compass still has a single needle and no hands
        Assert.Null(Catalog.Get("gate-of-secrets").Puzzle("g1-compass").PublicData["hands"]);
    }

    // ------------------------------------------------------------------ the bridge (retired from the game)

    /// <summary>The data the retired bridge had: the engine's ball roll is still covered, though no room uses it now.</summary>
    private static JsonObject BridgeData => JsonNode.Parse("""
        {"min":-3,"max":3,"start":[-2,2],"stations":4,"joint":2,"jointTolerance":1,"steep":3,"containerMaxSpeed":1,"coupled":true,"continuous":true}
        """)!.AsObject();

    [Fact]
    public void The_bridge_is_gone_and_the_gears_are_the_first_task_of_the_second_room()
    {
        var g = Start(1, "CCNOBR");
        Sounds(g);
        Assert.DoesNotContain(g.R.Puzzles, p => p.PuzzleId == "cc2-bridge");
        Assert.Equal(PuzzleStatus.Active, g.Status("cc2-gears"));
        Assert.Equal(PuzzleStatus.Locked, g.Status("cc2-track"));
    }

    [Fact]
    public void The_ball_rolls_by_the_slope_and_falls_when_it_is_too_steep_or_too_fast()
    {
        Assert.Equal("stuck", GameEngine.RollBall(BridgeData, 0, 0, 0).End);
        Assert.Equal("stuck", GameEngine.RollBall(BridgeData, 0, -1, 0).End);
        Assert.Equal("steep", GameEngine.RollBall(BridgeData, 0, 3, 3).End);
        var run = GameEngine.RollBall(BridgeData, 0, 1, 1);
        Assert.Equal("container", run.End);
        Assert.Equal([0, 1, 2, 3, 4], run.Path.ToArray());
        Assert.Equal("container", GameEngine.RollBall(BridgeData, 0, 2, 1).End);
        Assert.Equal("joint", GameEngine.RollBall(BridgeData, 0, 2, -1).End);
        var up = GameEngine.RollBall(BridgeData, 0, 1, 0);
        Assert.Equal("rest", up.End);
        Assert.Equal(2, up.Path[^1]);
        Assert.Equal("bounced", GameEngine.RollBall(BridgeData, 0, 2, 2).End);
        Assert.Equal("bounced", GameEngine.RollBall(BridgeData, 0, 1, 2).End);
        var stepwise = (JsonObject)BridgeData.DeepClone();
        stepwise.Remove("continuous");
        Assert.Equal([0, 1], GameEngine.RollBall(stepwise, 0, 1, 1).Path.ToArray());
    }

    // ------------------------------------------------------------------ the track

    [Fact]
    public void The_short_way_reaches_the_container_but_misses_the_lamps()
    {
        var data = Cc.Puzzle("cc2-track").PublicData;
        var start = GameEngine.PipeStart(data);
        Assert.False(GameEngine.PipeFlow(data, start).Reached);
        // the shortcut along the bottom: it reaches, but without the first lamp
        var shortcut = new Dictionary<string, int> { ["1,0"] = 2, ["2,0"] = 0, ["2,1"] = 2, ["3,1"] = 0, ["3,2"] = 0, ["3,3"] = 3, ["2,3"] = 1, ["2,4"] = 2, ["3,4"] = 0, ["3,5"] = 0 };
        var turns = start.ToList();
        foreach (var (cell, t) in shortcut) { var rc = cell.Split(',').Select(int.Parse).ToArray(); turns[rc[0] * 6 + rc[1]] = t; }
        var (cells, reached) = GameEngine.PipeFlow(data, turns);
        Assert.True(reached);
        Assert.False(GameEngine.PipeCheckpoints(data, cells));

        var g = Start(1, "CCTRCK");
        Sounds(g);
        foreach (var (slot, item) in new[] { ("g1", "cc-gear-r3-24"), ("g2", "cc-gear-r1-8"), ("g3", "cc-gear-r2-16") })
            g.Op(0, "cc2-gears", new { op = "place", slot, item });
        g.Op(0, "cc2-gears", new { op = "activate" });
        LayTrack(g, shortcut);
        g.Op(0, "cc2-track", new { op = "valve", id = "drain" });
        Assert.Equal("leaked", g.Op(0, "cc2-track", new { op = "valve", id = "main" }).Code);
        Assert.Equal(PuzzleStatus.Active, g.Status("cc2-track"));
    }

    [Fact]
    public void The_gears_need_the_right_teeth_not_only_the_right_size()
    {
        var g = Start(1, "CCGEAR");
        Sounds(g);
        // the right size with the wrong teeth goes on the pin like any gear; only the check finds it wrong
        foreach (var (slot, item) in new[] { ("g1", "cc-gear-r3-20"), ("g2", "cc-gear-r1-8"), ("g3", "cc-gear-r2-16") })
            Assert.True(g.Op(0, "cc2-gears", new { op = "place", slot, item }).Ok);
        Assert.Equal("wrong-answer", g.Op(0, "cc2-gears", new { op = "activate" }).Code);
        Assert.Equal(PuzzleStatus.Active, g.Status("cc2-gears"));
    }

    [Fact]
    public void Any_gear_goes_on_any_pin_and_only_the_check_says_whether_the_train_works()
    {
        var g = Start(2, "CCPINS");
        Sounds(g);
        // a gear that does not belong there is placed, with no verdict, no attempt counted and no points
        var before = g.R.Puzzles.First(p => p.PuzzleId == "cc2-gears").Attempts;
        var put = g.Op(0, "cc2-gears", new { op = "place", slot = "g1", item = "cc-gear-r1-8" });
        Assert.True(put.Ok);
        Assert.Equal("placed", put.Code);
        Assert.Equal("cc-gear-r1-8", g.Mech("cc2-gears").Slots["g1"]);
        Assert.Empty(g.Mech("cc2-gears").Verdict);
        Assert.Equal(before, g.R.Puzzles.First(p => p.PuzzleId == "cc2-gears").Attempts);
        Assert.DoesNotContain(g.World.Score!.Log, e => e.Key.StartsWith("placement:cc2-gears"));
        // it can be lifted off and tried elsewhere
        Assert.True(g.Op(1, "cc2-gears", new { op = "remove", slot = "g1" }).Ok);
        Assert.True(g.Op(1, "cc2-gears", new { op = "place", slot = "g2", item = "cc-gear-r1-8" }).Ok);
        Assert.Equal("not-ready", g.Op(0, "cc2-gears", new { op = "activate" }).Code);
        // a wrong train: the check says it does not turn, never which gear is wrong, and costs the room 5 points
        Assert.True(g.Op(0, "cc2-gears", new { op = "place", slot = "g1", item = "cc-gear-r3-20" }).Ok);
        Assert.True(g.Op(1, "cc2-gears", new { op = "place", slot = "g3", item = "cc-gear-r2-16" }).Ok);
        var wrong = g.Op(0, "cc2-gears", new { op = "activate" });
        Assert.Equal("wrong-answer", wrong.Code);
        Assert.Contains("−5", wrong.Message);
        Assert.DoesNotContain("פין 1", wrong.Message);
        Assert.DoesNotContain("24", wrong.Message);
        Assert.Contains(wrong.Notices, n => n.Kind == "wrong-answer" && n.PuzzleId == "cc2-gears");
        Assert.Equal(1, g.Mech("cc2-gears").Misses);
        Assert.Empty(g.Mech("cc2-gears").Verdict);
        // swapped for the right gear, the check completes it
        var later = T0.AddMinutes(2);
        Assert.True(g.Op(1, "cc2-gears", new { op = "remove", slot = "g1" }, later).Ok);
        Assert.True(g.Op(1, "cc2-gears", new { op = "place", slot = "g1", item = "cc-gear-r3-24" }, later).Ok);
        Assert.Equal("solved", g.Op(0, "cc2-gears", new { op = "activate" }, later).Code);
    }

    // ------------------------------------------------------------------ the house

    private static Game AtTheHouse(int players, string code)
    {
        var g = Start(players, code);
        Sounds(g); Partnership(g); Trust(g); Letters(g);
        return g;
    }

    [Fact]
    public void Any_stone_goes_in_any_gap_can_be_moved_and_nothing_tells_which_is_right_before_the_check()
    {
        var g = AtTheHouse(1, "CCHOM1");
        var before = g.R.Puzzles.First(p => p.PuzzleId == "cc6-wall").Attempts;
        var put = g.Op(0, "cc6-wall", new { op = "place", slot = "wave", item = "cc-stone-bell" });
        Assert.Equal("placed", put.Code);
        Assert.DoesNotContain("לא שייכת", put.Message);
        Assert.Equal("cc-stone-bell", g.Mech("cc6-wall").Slots["wave"]);
        Assert.Empty(g.Mech("cc6-wall").Verdict);
        Assert.Equal(before, g.R.Puzzles.First(p => p.PuzzleId == "cc6-wall").Attempts);
        // the stone can be taken out again and put elsewhere
        Assert.True(g.Op(0, "cc6-wall", new { op = "remove", slot = "wave" }).Ok);
        Assert.Contains("cc-stone-bell", g.World.WorldItems);
        Assert.Equal("placed", g.Op(0, "cc6-wall", new { op = "place", slot = "leaf", item = "cc-stone-bell" }).Code);
        Assert.Equal("not-ready", g.Op(0, "cc6-wall", new { op = "activate" }).Code);
    }

    [Fact]
    public void Each_wrong_check_of_the_wall_takes_points_off_the_room_and_every_screen_hears_of_it()
    {
        var g = AtTheHouse(2, "CCHOM4");
        // the whole wall with two stones swapped: the check fails without saying which
        var swapped = Wall.Select(w => w.Place == "wave" ? (w.Place, Stone: "cc-stone-bell") : w.Place == "leaf" ? (w.Place, Stone: "cc-stone-gear") : w).ToArray();
        for (var k = 0; k < swapped.Length; k++)
            Assert.Equal("placed", g.Op(k % 2, "cc6-wall", new { op = "place", slot = swapped[k].Place, item = swapped[k].Stone }).Code);
        var wrong = g.Op(1, "cc6-wall", new { op = "activate" });
        Assert.Equal("wrong-answer", wrong.Code);
        Assert.Contains("−5", wrong.Message);
        Assert.Contains(wrong.Notices, n => n.Kind == "wrong-answer" && n.PuzzleId == "cc6-wall");
        Assert.Empty(g.Mech("cc6-wall").Verdict);
        Assert.Equal(PuzzleStatus.Active, g.Status("cc6-wall"));
        // a second wrong check, later
        Assert.Equal("wrong-answer", g.Op(0, "cc6-wall", new { op = "activate" }, T0.AddMinutes(3)).Code);
        Assert.Equal(2, g.Mech("cc6-wall").Misses);
        Home(g, T0.AddMinutes(6));
        var full = Cc.Scoring!.Room[Cc.ZoneDifficulty["cc-home"]];
        var room = g.World.Score!.Log.Single(e => e.Key == "room:cc-home");
        Assert.Equal(full - 2 * 5, room.Points);
        Assert.Contains("2 הצבות שגויות", room.Reason);
    }

    [Fact]
    public void The_check_of_the_whole_right_wall_completes_it_and_the_game_for_both_players()
    {
        var g = AtTheHouse(2, "CCHOM2");
        foreach (var (slot, item) in Wall) Assert.Equal("placed", g.Op(1, "cc6-wall", new { op = "place", slot, item }).Code);
        // all five in place, still nothing until the check
        Assert.NotEqual(RoomPhase.Completed, g.R.Phase);
        var done = g.Op(0, "cc6-wall", new { op = "activate" });
        Assert.Equal("solved", done.Code);
        Assert.Equal(RoomPhase.Completed, g.R.Phase);
        Assert.Contains(done.Notices, n => n.Kind == "game-completed" && n.Message.Contains("ביחד"));
    }

    [Fact]
    public void The_first_task_points_to_the_symbol_board_and_the_texts_are_plain()
    {
        Assert.Equal("חפשו את לוח הסמלים ברחבי החדר וקראו את המספרים לפי סדר הצלילים.", Cc.Puzzle("cc1-listen").Objective);
        var board = Cc.Clues.Single(c => c.Id == "cc1-symbols-board").Text;
        Assert.Contains("1. קשת, 3 נקודות.", board);
        Assert.Contains("4. להבה, 6 נקודות.", board);
        Assert.Contains("\n", board);
        // the gears keep the blueprint's data and say it in plain words; nothing is judged piece by piece any more
        var gears = Cc.Puzzle("cc2-gears");
        Assert.DoesNotContain("יחס", gears.Instructions);
        Assert.Null(gears.PublicData["judgeEach"]);
        Assert.Null(Cc.Puzzle("cc6-wall").PublicData["judgeEach"]);
        var bp = Cc.Clues.Single(c => c.Id == "cc2-blueprint").Text;
        foreach (var part in new[] { "רדיוס 2", "5", "4", "3", "פי 8 מהרדיוס", "נגד כיוון השעון", "עם כיוון השעון" }) Assert.Contains(part, bp);
    }
}
