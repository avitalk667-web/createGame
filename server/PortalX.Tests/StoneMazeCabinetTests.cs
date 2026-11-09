using System.Text.Json;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>
/// "מבוך האבן", the Stone Hall, puzzle 3 — the mechanical cabinet: four symbol wheels set in the rune order raise the
/// cover of the number plate and show ancient letters (ג א ד ב) whose values give the code 3142; the code opens the cabinet
/// and the ancient key goes into the group's bag. And the optional golden chest, which the key opens without being used up.
/// </summary>
public class StoneMazeCabinetTests
{
    private static readonly DateTime T0 = new(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc);
    private const string Key = "gs-golden-key";

    private sealed record Game(GameEngine E, GameRoom R, List<PlayerSession> Ps)
    {
        public ActionOutcome Cab(int who, object a, DateTime? at = null) => E.Operate(R, Ps[who % Ps.Count].Id, "g1-cabinet", J(a), at ?? T0);
        public ActionOutcome Chest(int who, DateTime? at = null) => E.Operate(R, Ps[who % Ps.Count].Id, "g1-chest", J(new { op = "open" }), at ?? T0);
        public MechanismState Mech => GameEngine.World(R).Mechanisms["g1-cabinet"];
        public WorldState World => GameEngine.World(R);
        public PuzzleState State(string id) => R.Puzzles.First(p => p.PuzzleId == id);
    }

    /// <summary>A group that has done the pendulum, the map and the runes: the cabinet is next.</summary>
    private static Game AtCabinet(int players)
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("stone-maze", "CABI" + players + "X", "hash", T0);
        var ps = new List<PlayerSession>();
        for (var i = 0; i < players; i++)
        {
            Assert.True(e.AddPlayer(r, "שחקן" + i, GameEngine.Characters[i], "{}", "c" + i, i == 0, T0, out var p).Ok);
            p!.IsConnected = true;
            ps.Add(p);
        }
        for (var i = 1; i < players; i++) e.SetReady(r, ps[i].Id, true);
        Assert.True(e.StartGame(r, ps[0].Id, T0).Ok);
        Assert.True(e.FinishIntro(r, ps[0].Id, true, T0).Ok);
        var g = new Game(e, r, ps);
        Assert.Equal(PuzzleStatus.Locked, g.State("g1-cabinet").Status);
        Assert.Equal("locked", g.Cab(0, new { op = "turn", wheel = 0 }).Code);   // the wheels wait for the runes
        Assert.Equal(PuzzleStatus.Locked, g.State("g1-chest").Status);
        for (var round = 0; round < 3; round++)
        {
            e.Operate(r, ps[0].Id, "g1-pendulum", J(new { op = "start" }), T0);
            StoneMazeRoom1Tests.Freeze(e, r, ps[0], T0.AddSeconds(StoneMazeRoom1Tests.HitAt(Catalog.Get("stone-maze").Puzzle("g1-pendulum").PublicData["rounds"]![round]!)), TimeSpan.Zero);
        }
        StoneMazeRoom1Tests.Assemble(e, r, ps, T0);
        StoneMazeRunesTests.PlayRunes(e, r, ps, T0.AddSeconds(2));
        Assert.Equal(PuzzleStatus.Active, g.State("g1-cabinet").Status);
        return g;
    }

    private static void TurnTo(Game g, int[] target)
    {
        for (var k = 0; k < 4; k++)
            while (g.Mech.Rotations[k] != target[k]) Assert.True(g.Cab(k, new { op = "turn", wheel = k }).Ok);
    }

    [Fact]
    public void The_wheels_start_out_of_order_and_the_letters_show_only_when_all_four_are_right()
    {
        var g = AtCabinet(1);
        Assert.Equal([2, 0, 3, 1], g.Mech.Rotations);
        Assert.Equal("not-aligned", g.Cab(0, new { op = "code", code = "3142" }).Code);   // the plate is still covered
        TurnTo(g, [0, 1, 2, 2]);                                                          // three right, one wrong
        Assert.False(g.Mech.Ready);
        Assert.Empty(g.Mech.Backs);
        var last = g.Cab(3, new { op = "turn", wheel = 3 });
        Assert.Equal("aligned", last.Code);
        Assert.True(g.Mech.Ready);
        Assert.Equal("גאדב", string.Concat(Enumerable.Range(1, 4).Select(k => g.Mech.Backs[$"w{k}"])));
        // turning a wheel away covers the plate again
        g.Cab(1, new { op = "turn", wheel = 1 });
        Assert.False(g.Mech.Ready);
        Assert.Empty(g.Mech.Backs);
    }

    [Fact]
    public void Three_wrong_codes_lock_the_cabinet_for_a_while_and_the_right_code_gives_the_key()
    {
        var g = AtCabinet(2);
        TurnTo(g, [0, 1, 2, 3]);
        Assert.Equal("wrong", g.Cab(0, new { op = "code", code = "1234" }).Code);
        Assert.Equal("wrong", g.Cab(1, new { op = "code", code = "4321" }).Code);
        var third = g.Cab(0, new { op = "code", code = "2143" });
        Assert.Contains("ננעל", third.Message);
        Assert.Equal("cooldown", g.Cab(1, new { op = "code", code = "3142" }, T0.AddSeconds(5)).Code);
        Assert.Equal("solved", g.Cab(1, new { op = "code", code = "3142" }, T0.AddSeconds(21)).Code);
        Assert.Contains(Key, g.World.Inventory);
        Assert.Null(g.World.PendingZone);                                   // the cabinet itself opens no room
        Assert.Equal(PuzzleStatus.Active, g.State("g1-door").Status);       // the door can now be tried
        Assert.Equal(PuzzleStatus.Active, g.State("g1-chest").Status);      // and the golden chest
    }

    [Fact]
    public void The_code_and_letters_never_reach_the_browser_before_the_wheels_are_right()
    {
        var g = AtCabinet(1);
        var scenario = Snapshots.PublicScenario(Catalog.Get("stone-maze")).ToJsonString();
        Assert.DoesNotContain("3142", scenario);
        Assert.DoesNotContain("\"letters\"", scenario);
        g.Cab(0, new { op = "turn", wheel = 0 });   // the cabinet's state now exists, still out of order
        var snap = JsonSerializer.Serialize(Snapshots.Build(g.E, g.R, null, T0));
        Assert.DoesNotContain("\"w1\"", snap);       // no letter on any back yet
    }

    [Fact]
    public void The_golden_chest_is_a_short_bonus_the_key_opens_without_being_used_up()
    {
        var g = AtCabinet(2);
        Assert.Equal("locked", g.Chest(0).Code);                    // before the cabinet: locked
        StoneMazeRoom1Tests.OpenCabinet(g.E, g.R, g.Ps, T0);
        var before = g.World.Score!.Personal.Values.Sum();
        var opened = g.Chest(1);
        Assert.Equal("solved", opened.Code);
        Assert.Contains(Key, g.World.Inventory);                    // the key stays for the door
        Assert.Equal(before + 10, g.World.Score.Personal.Values.Sum());
        Assert.Null(g.World.PendingZone);                           // the chest opens no room
        Assert.False(g.Chest(0).Ok);                                // once only
        Assert.Equal(before + 10, g.World.Score.Personal.Values.Sum());
        // and the door still opens with the same key
        Assert.Equal("solved", g.E.Operate(g.R, g.Ps[0].Id, "g1-door", J(new { op = "unlock" }), T0).Code);
    }

    [Fact]
    public void The_door_opens_without_the_chest_and_the_chest_never_blocks_the_way()
    {
        var g = AtCabinet(1);
        StoneMazeRoom1Tests.OpenCabinet(g.E, g.R, g.Ps, T0);
        Assert.Equal("solved", g.E.Operate(g.R, g.Ps[0].Id, "g1-door", J(new { op = "unlock" }), T0).Code);
        Assert.Equal("gearworks", g.World.PendingZone);
        Assert.Equal(PuzzleStatus.Active, g.State("g1-chest").Status);   // still there to open, or to leave
    }
}
