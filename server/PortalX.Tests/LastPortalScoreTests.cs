using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>
/// "הפורטל האחרון" scores like the Hanukkah game: each player's own points for what they did (once per action), the group's
/// points apart, everything kept by the server and sent to every player — also after a reconnection or a late join.
/// </summary>
public class LastPortalScoreTests
{
    private static readonly DateTime T0 = new(2026, 1, 1, 10, 0, 0, DateTimeKind.Utc);
    private static ScoreBoard Board(GameRoom r) => GameEngine.World(r).Score!;
    private static int Mine(GameRoom r, PlayerSession p) => Board(r).Personal.GetValueOrDefault(p.Id.ToString());

    [Fact]
    public void A_whole_game_gives_each_player_their_own_points_and_ends_with_a_ranking()
    {
        var (e, r, ps) = Setup();
        StartPlaying(e, r, ps);
        var t = T0.AddMinutes(1);

        Assert.True(e.PickUp(r, ps[3].Id, "handle", t).Ok);
        Assert.Equal(10, Mine(r, ps[3]));
        Assert.Equal(0, Mine(r, ps[0]));
        Assert.Equal("solved", e.SubmitAnswer(r, ps[1].Id, "p1-cipher", J("שער"), t).Code);
        Assert.Equal(25, Mine(r, ps[1]));
        Assert.Equal("solved", e.SubmitAnswer(r, ps[2].Id, "p2-sequence", J(new[] { "sun", "crown", "leaf", "star" }), t).Code);
        Assert.Equal("solved", e.SubmitAnswer(r, ps[0].Id, "p3-sound", J(new[] { "gimel", "aleph", "dalet", "aleph", "bet" }), t).Code);
        Assert.Equal("solved", e.SubmitAnswer(r, ps[3].Id, "p4-split", J("749"), t).Code);
        Assert.True(e.Combine(r, ps[0].Id, "handle", "gear", t).Ok);
        Assert.True(e.PlaceItem(r, ps[1].Id, "p5-items", "crystal", t).Ok);
        Assert.Equal("solved", e.PlaceItem(r, ps[2].Id, "p5-items", "mechanism", t).Code);
        Assert.Equal("solved", e.SubmitAnswer(r, ps[0].Id, "p6-final", J(new[] { "א", "מ", "ו", "נ", "ה" }), T0.AddMinutes(20)).Code);
        Assert.Equal(RoomPhase.Completed, r.Phase);

        var board = Board(r);
        // everyone who did something has points of their own; nothing was counted twice
        Assert.All(ps, p => Assert.True(Mine(r, p) > 0));
        Assert.Equal(board.Log.Count, board.Log.Select(l => l.Key).Distinct().Count());
        Assert.Equal(board.Log.Where(l => l.PlayerId != null).Sum(l => l.Points), board.Personal.Values.Sum());
        // the group's points are apart from the personal ones: the rooms the group completed
        Assert.Equal(board.Log.Where(l => l.PlayerId == null).Sum(l => l.Points), board.Group);
        Assert.Equal(board.Rooms.Values.Sum(), board.Group);
        Assert.True(board.Group > 0);

        // the end screen: every player, ranked by their points, the first one on top
        var score = Snapshots.Build(e, r, e.BuildResult(r), T0.AddMinutes(20)).Score!;
        Assert.Equal(4, score.Players.Count);
        Assert.Equal(score.Players.OrderByDescending(p => p.Points).Select(p => p.Points), score.Players.Select(p => p.Points));
        Assert.Equal(1, score.Players[0].Rank);
        Assert.Equal(board.Group, score.Group);
    }

    [Fact]
    public void Repeating_an_action_gives_no_more_points()
    {
        var (e, r, ps) = Setup(2);
        StartPlaying(e, r, ps);
        Assert.True(e.PickUp(r, ps[0].Id, "handle", T0).Ok);
        Assert.False(e.PickUp(r, ps[0].Id, "handle", T0).Ok);       // already in the bag
        Assert.False(e.PickUp(r, ps[1].Id, "handle", T0).Ok);
        Assert.Equal("solved", e.SubmitAnswer(r, ps[1].Id, "p1-cipher", J("שער"), T0).Code);
        Assert.Equal("already-solved", e.SubmitAnswer(r, ps[1].Id, "p1-cipher", J("שער"), T0).Code);
        Assert.Equal(10, Mine(r, ps[0]));
        Assert.Equal(25, Mine(r, ps[1]));
    }

    [Fact]
    public void A_reconnection_keeps_the_points_and_a_late_joiner_sees_everyones_score()
    {
        var (e, r, ps) = Setup(2);
        StartPlaying(e, r, ps);
        Assert.Equal("solved", e.SubmitAnswer(r, ps[1].Id, "p1-cipher", J("שער"), T0).Code);
        var before = Mine(r, ps[1]);

        Assert.True(e.Disconnect(r, ps[1].Id, "c1", T0.AddSeconds(5)).Ok);
        Assert.True(e.Reconnect(r, ps[1].Id, "c2", T0.AddSeconds(30)).Ok);
        Assert.Equal(before, Mine(r, ps[1]));

        Assert.True(e.AddPlayer(r, "מאוחר", GameEngine.Characters[2], "{}", "t9", false, T0.AddMinutes(1), out var late).Ok);
        late!.IsConnected = true;
        var score = Snapshots.Build(e, r, null, T0.AddMinutes(1)).Score!;
        Assert.Equal(3, score.Players.Count);
        Assert.Equal(before, score.Players.Single(p => p.PlayerId == ps[1].Id).Points);
        Assert.Equal(0, score.Players.Single(p => p.PlayerId == late.Id).Points);
        Assert.Equal(Board(r).Group, score.Group);
    }
}
