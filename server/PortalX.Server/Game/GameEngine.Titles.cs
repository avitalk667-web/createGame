using PortalX.Server.Content;
using PortalX.Server.Domain;

namespace PortalX.Server.Game;

/// <summary>A personal title of the round: who earned it (several on a tie) and how many verified events gave it.</summary>
public sealed record TitleDto(string Id, string Title, string Description, string Icon, int Count, IReadOnlyList<Guid> Winners);

/// <summary>
/// End-of-game personal titles. They are counted only from what the server already verified and recorded once: the score
/// log (each key is unique, so pressing again adds nothing) and who solved each puzzle. A title with no event goes to
/// nobody; on a tie every player with the top count gets it.
/// </summary>
public sealed partial class GameEngine
{
    public static readonly string[] TitleRules = ["discoveries", "puzzles", "mechanisms", "hintless"];

    private static readonly string[] DiscoveryTypes = ["found", "symbol", "clue", "pickup"];
    private static readonly string[] StepTypes = ["mechanism", "placement", "stage"];

    public static List<TitleDto> Titles(ScenarioContent scenario, GameRoom room, WorldState world)
    {
        if (scenario.Titles.Count == 0) return [];
        var log = (world.Score ?? new ScoreBoard()).Log;
        var mechanisms = scenario.Puzzles.Where(p => MechanismTypes.Contains(p.Type)).Select(p => p.Id).ToHashSet();
        var hintless = room.Puzzles.Where(s => s.Status == PuzzleStatus.Solved && s.HintsRevealed == 0).Select(s => s.PuzzleId).ToHashSet();
        var players = ActivePlayers(room).OrderBy(p => p.Seat).ToList();

        // the puzzles a player helped solve: any verified step of the puzzle, or solving it
        HashSet<string> Helped(string pid) => log.Where(e => e.PlayerId == pid && e.PuzzleId != null).Select(e => e.PuzzleId!)
            .Concat(room.Puzzles.Where(s => s.Status == PuzzleStatus.Solved && s.SolvedByPlayerId?.ToString() == pid).Select(s => s.PuzzleId))
            .ToHashSet();

        int Count(string rule, string pid) => rule switch
        {
            "discoveries" => log.Count(e => e.PlayerId == pid && DiscoveryTypes.Contains(e.Type)),
            "puzzles" => Helped(pid).Count,
            "hintless" => Helped(pid).Count(hintless.Contains),
            // each correct placement, maze stage and mechanism solve once (a solve worth no points is still counted)
            "mechanisms" => log.Where(e => e.PlayerId == pid && e.PuzzleId != null && mechanisms.Contains(e.PuzzleId) && StepTypes.Contains(e.Type))
                .Select(e => e.Type == "mechanism" ? "solve:" + e.PuzzleId : e.Key)
                .Concat(room.Puzzles.Where(s => s.Status == PuzzleStatus.Solved && mechanisms.Contains(s.PuzzleId) && s.SolvedByPlayerId?.ToString() == pid)
                    .Select(s => "solve:" + s.PuzzleId))
                .Distinct().Count(),
            _ => 0,
        };

        return scenario.Titles.Select(t =>
        {
            var counts = players.Select(p => (p.Id, N: Count(t.Rule, p.Id.ToString()))).ToList();
            var top = counts.Count == 0 ? 0 : counts.Max(c => c.N);
            var winners = top == 0 ? [] : counts.Where(c => c.N == top).Select(c => c.Id).ToList();
            return new TitleDto(t.Id, t.Title, t.Description, t.Icon, top, winners);
        }).ToList();
    }
}
