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
        Assert.Equal("solved", g.Answer(0, "cc1-missing", "38").Code);
        g.Continue();
    }

    /// <summary>The bridge as one player can do it: latch one half, move the other, release.</summary>
    public static void Bridge(Game g, int a = 0, int b = 0)
    {
        Assert.True(g.Op(a, "cc2-bridge", new { op = "latch", side = 1 }).Ok);
        for (var i = 0; i < 3; i++) Assert.True(g.Op(a, "cc2-bridge", new { op = "tilt", side = 0, dir = 1 }).Ok);   // -2 → 1
        Assert.Equal("rolled", g.Op(a, "cc2-bridge", new { op = "release" }).Code);   // station 1
        Assert.Equal("rolled", g.Op(b, "cc2-bridge", new { op = "release" }).Code);   // the joint
        Assert.True(g.Op(b, "cc2-bridge", new { op = "latch", side = 1 }).Ok);        // free the right half
        Assert.True(g.Op(b, "cc2-bridge", new { op = "latch", side = 0 }).Ok);        // hold the left
        Assert.True(g.Op(b, "cc2-bridge", new { op = "tilt", side = 1, dir = -1 }).Ok); // 2 → 1
        Assert.Equal("rolled", g.Op(a, "cc2-bridge", new { op = "release" }).Code);   // station 3
        Assert.Equal("solved", g.Op(b, "cc2-bridge", new { op = "release" }).Code);   // the container
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
        Bridge(g, 0, 1);
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

    public static readonly (string Stage, (string Socket, string Item, int Turns)[] Parts)[] House =
    [
        ("foundation", [("f-nw", "cc-base-arch", 0), ("f-ne", "cc-base-flame", 0), ("f-se", "cc-foundation-stone", 0), ("f-sw", "cc-base-wave", 0)]),
        ("walls", [("w-n", "cc-wall-hidden", 2), ("w-e", "cc-wall-door", 2), ("w-s", "cc-wall-garden", 0), ("w-w", "cc-wall-plain", 1)]),
        ("openings", [("o-door", "cc-door", 0), ("o-garden", "cc-win-trio", 0), ("o-hidden", "cc-win-single", 0)]),
        ("roof", [("r-west", "cc-roof-left", 0), ("r-east", "cc-roof-right", 0), ("r-ridge", "cc-seal", 0)]),
        ("heart", [("h-axle", "cc-heart-gear", 0)]),
    ];

    public static ActionOutcome BuildStage(Game g, int stage)
    {
        var k = 0;
        foreach (var (socket, item, turns) in House[stage].Parts)
        {
            Assert.True(g.Op(k, "cc6-build", new { op = "place", socket, item }).Ok, item);
            for (var t = 0; t < turns; t++) Assert.True(g.Op(k, "cc6-build", new { op = "turn", socket }).Ok);
            k++;
        }
        return g.Op(0, "cc6-build", new { op = "check" });
    }

    public static void Home(Game g)
    {
        for (var s = 0; s < House.Length - 1; s++) Assert.Equal("stage", BuildStage(g, s).Code);
        Assert.Equal("solved", BuildStage(g, House.Length - 1).Code);
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
        Assert.Equal(["cc6-build"], Cc.Puzzles.Where(p => p.Zone == "cc-home").Select(p => p.Id).ToArray());
        // only one puzzle built for two: the bridge
        Assert.Single(Cc.Puzzles, p => p.Type == "bridge");
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
        // the two house plans hang in the building room
        Assert.Contains(Cc.Clues, c => c.Id == "cc6-plan-746" && c.Zone == "cc-home");
        Assert.Contains(Cc.Clues, c => c.Id == "cc6-plan-128" && c.Zone == "cc-home");
        // the rooms are numbered 1–5 without a gap
        Assert.Equal([1, 2, 3, 4, 5], Cc.Zones.Select(z => z.Order).OrderBy(o => o).ToArray());
    }

    [Fact]
    public void Every_reward_is_a_part_of_the_house()
    {
        var rewards = Cc.Puzzles.Where(p => p.RewardItem != null).Select(p => p.RewardItem!).ToList();
        var house = Cc.Puzzle("cc6-build").Solution.AsObject().SelectMany(st => st.Value!.AsObject().Select(kv => kv.Value!.GetValue<string>().Split('@')[0])).ToHashSet();
        Assert.Equal(7, rewards.Count);
        Assert.All(rewards, r => Assert.Contains(r, house));
        // every room before the house gives at least one part
        Assert.All(Cc.Zones.Take(4), z => Assert.Contains(Cc.Puzzles, p => p.Zone == z.Id && p.RewardItem != null));
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
        // nothing collected is left over: every reward went into the house
        Assert.DoesNotContain(g.World.Inventory, i => Cc.Puzzles.Any(p => p.RewardItem == i));
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
        Assert.Equal(25 + 25, board.Personal[g.Ps[0].Id.ToString()]);
        Assert.Equal(20, board.Personal[g.Ps[1].Id.ToString()]);
        // a hint costs the room's group points, as in the other games
        Assert.True(g.E.RequestHint(g.R, g.Ps[0].Id, "cc2-bridge", T0).Ok);
        Bridge(g);
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

    // ------------------------------------------------------------------ the bridge

    private static JsonObject BridgeData => Cc.Puzzle("cc2-bridge").PublicData;

    [Fact]
    public void The_ball_rolls_by_the_slope_and_falls_when_it_is_too_steep_or_too_fast()
    {
        Assert.Equal("stuck", GameEngine.RollBall(BridgeData, 0, 0, 0).End);
        Assert.Equal("stuck", GameEngine.RollBall(BridgeData, 0, -1, 0).End);
        Assert.Equal("steep", GameEngine.RollBall(BridgeData, 0, 3, 3).End);
        Assert.Equal([0, 1], GameEngine.RollBall(BridgeData, 0, 1, 1).Path.ToArray());
        // two stations at once, to the joint, where the halves must meet
        Assert.Equal("rest", GameEngine.RollBall(BridgeData, 0, 2, 2).End);
        Assert.Equal("joint", GameEngine.RollBall(BridgeData, 0, 2, -1).End);
        // uphill on the other half stops it at the joint
        var up = GameEngine.RollBall(BridgeData, 1, 1, 0);
        Assert.Equal("rest", up.End);
        Assert.Equal(2, up.Path[^1]);
        // into the container: gently only
        Assert.Equal("bounced", GameEngine.RollBall(BridgeData, 2, 2, 2).End);
        Assert.Equal("container", GameEngine.RollBall(BridgeData, 3, 1, 1).End);
    }

    [Fact]
    public void The_halves_move_like_a_seesaw_unless_latched_and_a_fall_sends_the_ball_back()
    {
        var g = Start(2, "CCBRDG");
        Sounds(g);
        Assert.Equal([-2, 2], g.Mech("cc2-bridge").Rotations.ToArray());
        Assert.True(g.Op(0, "cc2-bridge", new { op = "tilt", side = 0, dir = 1 }).Ok);
        Assert.Equal([-1, 1], g.Mech("cc2-bridge").Rotations.ToArray());
        // latched: the right half stays, and a latched half cannot be moved
        Assert.True(g.Op(1, "cc2-bridge", new { op = "latch", side = 1 }).Ok);
        Assert.True(g.Op(0, "cc2-bridge", new { op = "tilt", side = 0, dir = 1 }).Ok);
        Assert.Equal([0, 1], g.Mech("cc2-bridge").Rotations.ToArray());
        Assert.Equal("latched", g.Op(0, "cc2-bridge", new { op = "tilt", side = 1, dir = 1 }).Code);
        // too steep: the ball falls and goes back to the start
        Assert.True(g.Op(0, "cc2-bridge", new { op = "tilt", side = 0, dir = 1 }).Ok);
        Assert.True(g.Op(0, "cc2-bridge", new { op = "tilt", side = 0, dir = 1 }).Ok);
        Assert.True(g.Op(0, "cc2-bridge", new { op = "tilt", side = 0, dir = 1 }).Ok);
        Assert.Equal("fell", g.Op(1, "cc2-bridge", new { op = "release" }).Code);
        Assert.Equal(0, g.Mech("cc2-bridge").Progress);
        Assert.Equal("steep", g.Mech("cc2-bridge").Revealed);
    }

    [Fact]
    public void The_ball_on_the_joint_falls_when_the_halves_part()
    {
        var g = Start(1, "CCJOIN");
        Sounds(g);
        g.Op(0, "cc2-bridge", new { op = "latch", side = 1 });
        for (var i = 0; i < 3; i++) g.Op(0, "cc2-bridge", new { op = "tilt", side = 0, dir = 1 });
        g.Op(0, "cc2-bridge", new { op = "release" });
        g.Op(0, "cc2-bridge", new { op = "release" });
        Assert.Equal(2, g.Mech("cc2-bridge").Progress);
        // the left half down by one (latched right half stays at 2): 0 vs 2 — too far apart
        Assert.Equal("fell", g.Op(0, "cc2-bridge", new { op = "tilt", side = 0, dir = -1 }).Code);
        Assert.Equal(0, g.Mech("cc2-bridge").Progress);
        Assert.Equal("joint", g.Mech("cc2-bridge").Revealed);
    }

    [Fact]
    public void One_player_can_carry_the_ball_across_alone()
    {
        var g = Start(1, "CCSOLO");
        Sounds(g);
        Bridge(g);
        Assert.Equal(PuzzleStatus.Solved, g.Status("cc2-bridge"));
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
        Bridge(g);
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
        Bridge(g);
        foreach (var (slot, item) in new[] { ("g1", "cc-gear-r3-20"), ("g2", "cc-gear-r1-8"), ("g3", "cc-gear-r2-16") })
            g.Op(0, "cc2-gears", new { op = "place", slot, item });
        Assert.NotEqual("solved", g.Op(0, "cc2-gears", new { op = "activate" }).Code);
        Assert.Equal(PuzzleStatus.Active, g.Status("cc2-gears"));
    }

    // ------------------------------------------------------------------ the house

    private static Game AtTheHouse(int players, string code)
    {
        var g = Start(players, code);
        Sounds(g); Partnership(g); Trust(g); Letters(g);
        return g;
    }

    [Fact]
    public void A_wrong_stage_does_not_lock_or_say_which_part_is_wrong()
    {
        var g = AtTheHouse(1, "CCHOM1");
        // the look-alike star stone instead of the wave stone
        g.Op(0, "cc6-build", new { op = "place", socket = "f-nw", item = "cc-base-arch" });
        g.Op(0, "cc6-build", new { op = "place", socket = "f-ne", item = "cc-base-flame" });
        g.Op(0, "cc6-build", new { op = "place", socket = "f-se", item = "cc-foundation-stone" });
        g.Op(0, "cc6-build", new { op = "place", socket = "f-sw", item = "cc-base-star" });
        var wrong = g.Op(0, "cc6-build", new { op = "check" });
        Assert.Equal("wrong-answer", wrong.Code);
        Assert.DoesNotContain("כוכב", wrong.Message);
        Assert.Equal(0, g.Mech("cc6-build").Progress);
        // the next stage stays closed until this one is right
        Assert.Equal("bad-socket", g.Op(0, "cc6-build", new { op = "place", socket = "w-n", item = "cc-wall-hidden" }).Code);
        // swap the stone back: it returns to the shelf in the room
        Assert.True(g.Op(0, "cc6-build", new { op = "remove", socket = "f-sw" }).Ok);
        Assert.Contains("cc-base-star", g.World.WorldItems);
        Assert.True(g.Op(0, "cc6-build", new { op = "place", socket = "f-sw", item = "cc-base-wave" }).Ok);
        Assert.Equal("stage", g.Op(0, "cc6-build", new { op = "check" }).Code);
        Assert.Equal(1, g.Mech("cc6-build").Progress);
    }

    [Fact]
    public void A_wall_turned_to_the_wrong_side_is_wrong_and_the_parts_lock_once_right()
    {
        var g = AtTheHouse(2, "CCHOM2");
        Assert.Equal("stage", BuildStage(g, 0).Code);
        foreach (var (socket, item) in new[] { ("w-n", "cc-wall-hidden"), ("w-e", "cc-wall-door"), ("w-s", "cc-wall-garden"), ("w-w", "cc-wall-plain") })
            g.Op(0, "cc6-build", new { op = "place", socket, item });
        Assert.Equal("wrong-answer", g.Op(1, "cc6-build", new { op = "check" }).Code);
        g.Op(0, "cc6-build", new { op = "turn", socket = "w-n" });
        g.Op(0, "cc6-build", new { op = "turn", socket = "w-n" });
        g.Op(0, "cc6-build", new { op = "turn", socket = "w-e" });
        g.Op(0, "cc6-build", new { op = "turn", socket = "w-e" });
        Assert.False(g.Op(0, "cc6-build", new { op = "turn", socket = "f-nw" }).Ok);
        Assert.Equal("stage", g.Op(1, "cc6-build", new { op = "check" }).Code);
        Assert.Equal(new[] { "f-ne", "f-nw", "f-se", "f-sw", "w-e", "w-n", "w-s", "w-w" }, g.Mech("cc6-build").Verdict.Keys.Order().ToArray());
        // placements score for the player who placed them, once the stage is right
        Assert.Contains(g.World.Score!.Log, e => e.Key == "placement:cc6-build:w-n" && e.PlayerId == g.Ps[0].Id.ToString());
    }

    [Fact]
    public void The_plain_gear_does_not_start_the_house()
    {
        var g = AtTheHouse(1, "CCHOM3");
        for (var s = 0; s < 4; s++) Assert.Equal("stage", BuildStage(g, s).Code);
        g.Op(0, "cc6-build", new { op = "place", socket = "h-axle", item = "cc-gear-plain" });
        Assert.Equal("wrong-answer", g.Op(0, "cc6-build", new { op = "check" }).Code);
        Assert.NotEqual(RoomPhase.Completed, g.R.Phase);
        g.Op(0, "cc6-build", new { op = "remove", socket = "h-axle" });
        g.Op(0, "cc6-build", new { op = "place", socket = "h-axle", item = "cc-heart-gear" });
        var done = g.Op(0, "cc6-build", new { op = "check" });
        Assert.Equal("solved", done.Code);
        Assert.Equal(RoomPhase.Completed, g.R.Phase);
        Assert.Contains(done.Notices, n => n.Kind == "game-completed" && n.Message.Contains("ביחד"));
    }
}
