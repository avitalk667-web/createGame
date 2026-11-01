using PortalX.Server.Content;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>The group bonus for a puzzle solved without a hint: its value comes from the scenario's scoring settings.</summary>
public class NoHintBonusTests
{
    private static readonly DateTime T0 = new(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc);
    private static ScenarioContent Content => Catalog.Get("hanukkah-oil");

    private static (GameEngine e, GameRoom r, List<PlayerSession> ps) Start()
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("hanukkah-oil", "NOH234", "hash", T0);
        var ps = new List<PlayerSession>();
        for (var i = 0; i < 2; i++)
        {
            Assert.True(e.AddPlayer(r, "שחקן" + i, GameEngine.Characters[i], "{}", "t" + i, i == 0, T0, out var p).Ok);
            p!.IsConnected = true;
            ps.Add(p);
        }
        e.SetReady(r, ps[1].Id, true);
        Assert.True(e.StartGame(r, ps[0].Id, T0).Ok);
        Assert.True(e.FinishIntro(r, ps[0].Id, true, T0).Ok);
        return (e, r, ps);
    }

    private static ScoreBoard Board(GameRoom r) => GameEngine.World(r).Score!;

    [Fact]
    public void A_hintless_solve_gives_the_group_the_configured_bonus_once_and_a_hint_cancels_it()
    {
        Assert.Equal(10, Content.Scoring!.NoHint);
        var (e, r, ps) = Start();
        var personal = () => Board(r).Personal.Values.Sum();

        // the four objects, no hint: the group gets 10, the players only their own points
        foreach (var o in LibraryChain.Objects)
        {
            e.Operate(r, ps[0].Id, "h1-evidence", J(new { op = "inspect", target = o }), T0);
            e.Operate(r, ps[0].Id, "h1-evidence", J(new { op = "reveal", target = o }), T0);
        }
        Assert.Equal(10, Board(r).Group);
        Assert.Equal(10, Board(r).Rooms["library"]);
        Assert.Equal(4 * 10 + 4 * 15, personal());
        Assert.Single(Board(r).Log, x => x.Key == "nohint:h1-evidence" && x.PlayerId == null && x.Points == 10);

        // the board after a hint: no bonus for it
        Assert.True(e.RequestHint(r, ps[1].Id, "h1-board", T0).Ok);
        foreach (var (slot, item) in LibraryChain.Board) e.Operate(r, ps[1].Id, "h1-board", J(new { op = "place", slot, item }), T0);
        Assert.Equal(PuzzleStatus.Solved, r.Puzzles.First(p => p.PuzzleId == "h1-board").Status);
        Assert.DoesNotContain(Board(r).Log, x => x.Key == "nohint:h1-board");
        Assert.Equal(10, Board(r).Group);

        // a solved puzzle cannot be solved again, so its bonus never repeats
        Assert.Equal("already-solved", e.Operate(r, ps[0].Id, "h1-evidence", J(new { op = "inspect", target = "book" }), T0).Code);
        Assert.Equal(Board(r).Log.Count, Board(r).Log.Select(x => x.Key).Distinct().Count());
    }

    [Fact]
    public void Rooms_seven_and_eight_and_the_bonus_scales_keep_their_scoring()
    {
        var rules = Content.Scoring!;
        Assert.Equal(["mosaic", "hall"], rules.NoHintSkipZones);
        Assert.All(Content.Puzzles.Where(p => p.Zone is "mosaic" or "hall"), p => Assert.Contains(p.Zone, rules.NoHintSkipZones));
        // a scenario without the setting gives no bonus at all
        Assert.Equal(0, new ScoringRules().NoHint);
    }
}
