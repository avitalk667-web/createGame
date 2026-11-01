using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>The magnetic maze's shared control: one player moves the key at a time; the maze itself is unchanged.</summary>
public class MazeControlTests
{
    private static readonly DateTime T0 = new(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc);

    /// <summary>A game whose group stands in the maze room (rooms 1 and 2 done by the first player).</summary>
    private static (GameEngine e, GameRoom r, List<PlayerSession> ps) InMaze(int players)
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("hanukkah-oil", "MAZ234", "hash", T0);
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
        Assert.True(e.Continue(r, me, T0).Ok);
        return (e, r, ps);
    }

    private static ActionOutcome Move(GameEngine e, GameRoom r, PlayerSession p, string dir, DateTime at) =>
        e.Operate(r, p.Id, "h3-maze", J(new { op = "move", dir }), at);
    private static MechanismState Maze(GameRoom r) => GameEngine.World(r).Mechanisms["h3-maze"];

    [Fact]
    public void Only_one_player_moves_the_key_until_he_lets_go_or_pauses()
    {
        var (e, r, ps) = InMaze(4);
        Assert.Equal("moved", Move(e, r, ps[0], "S", T0).Code);
        Assert.Equal(ps[0].Id.ToString(), Maze(r).Controller);
        // a competing command a moment later is refused and does not move the key
        var busy = Move(e, r, ps[1], "S", T0.AddMilliseconds(300));
        Assert.Equal("maze-busy", busy.Code);
        Assert.Contains("שחקן0", busy.Message);
        Assert.Equal([2, 1], Maze(r).Key);
        // the holder keeps moving (a long press), each step renewing the hold
        Assert.Equal("moved", Move(e, r, ps[0], "S", T0.AddMilliseconds(600)).Code);
        Assert.Equal("maze-busy", Move(e, r, ps[2], "N", T0.AddMilliseconds(1700)).Code);   // still within 1.2 s of the last step
        // letting go hands the key over at once
        Assert.Equal("released", e.Operate(r, ps[0].Id, "h3-maze", J(new { op = "release" }), T0.AddMilliseconds(800)).Code);
        Assert.Null(Maze(r).Controller);
        Assert.Equal("moved", Move(e, r, ps[1], "N", T0.AddMilliseconds(900)).Code);
        // a player who simply stops (or drops) loses the hold after a short pause
        Assert.Equal("moved", Move(e, r, ps[3], "N", T0.AddMilliseconds(900 + 1300)).Code);
        Assert.Equal(ps[3].Id.ToString(), Maze(r).Controller);
        // releasing someone else's hold changes nothing
        Assert.Equal("noop", e.Operate(r, ps[0].Id, "h3-maze", J(new { op = "release" }), T0.AddMilliseconds(2300)).Code);
        Assert.Equal(ps[3].Id.ToString(), Maze(r).Controller);
    }

    [Fact]
    public void A_wall_bump_keeps_the_key_in_place_and_levers_stay_free_for_everyone()
    {
        var (e, r, ps) = InMaze(2);
        var blocked = Move(e, r, ps[0], "N", T0);                 // the start cell has a wall above it
        Assert.Equal("blocked", blocked.Code);
        Assert.Equal([1, 1], Maze(r).Key);
        Assert.Equal(ps[0].Id.ToString(), Maze(r).Controller);   // the bump still counts as holding the magnet
        // the other player pulls a lever while the key is held: gates are not the key
        Assert.True(e.Operate(r, ps[1].Id, "h3-maze", J(new { op = "lever", index = 0 }), T0.AddMilliseconds(100)).Ok);
        Assert.True(Maze(r).Levers[0]);
    }

    [Fact]
    public void A_single_player_follows_the_same_route_and_the_box_code_is_still_825()
    {
        var (e, r, ps) = InMaze(1);
        var p = ps[0];
        var t = T0;
        void Go(string dirs) { foreach (var d in dirs) Assert.True(Move(e, r, p, d.ToString(), t = t.AddMilliseconds(300)).Ok); }
        Go("EE");
        Assert.True(e.Operate(r, p.Id, "h3-maze", J(new { op = "lever", index = 0 }), t).Ok);
        Go("EEEE");                                                 // star
        Go("SSW");
        Assert.True(e.Operate(r, p.Id, "h3-maze", J(new { op = "lever", index = 1 }), t).Ok);
        Go("WWW");                                                  // flame
        Go("SS");
        Assert.True(e.Operate(r, p.Id, "h3-maze", J(new { op = "lever", index = 2 }), t).Ok);
        Go("E");                                                    // menorah
        Go("EE");
        Assert.Equal("solved", Move(e, r, p, "E", t.AddMilliseconds(300)).Code);   // the exit
        Assert.Equal("825", Maze(r).Revealed);
        Assert.Equal("wrong", e.SubmitAnswer(r, p.Id, "h3-box", J("123"), t).Code);
        Assert.Equal("solved", e.SubmitAnswer(r, p.Id, "h3-box", J("825"), t).Code);
        Assert.Contains("golden-key", GameEngine.World(r).Inventory);
    }

    [Fact]
    public void The_maze_survives_a_reload_and_cannot_be_moved_from_another_room()
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("hanukkah-oil", "MZL234", "hash", T0);
        Assert.True(e.AddPlayer(r, "אחד", "explorer", "{}", "t0", true, T0, out var p).Ok);
        p!.IsConnected = true;
        Assert.True(e.StartGame(r, p.Id, T0).Ok);
        Assert.True(e.FinishIntro(r, p.Id, true, T0).Ok);
        // the group is still in the library: the maze is locked
        Assert.Equal("locked", Move(e, r, p, "S", T0).Code);

        var (e2, r2, ps) = InMaze(2);
        Assert.True(Move(e2, r2, ps[0], "S", T0).Ok);
        Assert.True(Move(e2, r2, ps[0], "S", T0.AddMilliseconds(300)).Ok);
        // the state lives in the saved world: a fresh engine reading the same room sees the same key and controller
        var again = new GameEngine(Catalog, new GameOptions());
        Assert.Equal([3, 1], GameEngine.World(r2).Mechanisms["h3-maze"].Key);
        Assert.Equal("maze-busy", again.Operate(r2, ps[1].Id, "h3-maze", J(new { op = "move", dir = "N" }), T0.AddMilliseconds(500)).Code);
    }
}
