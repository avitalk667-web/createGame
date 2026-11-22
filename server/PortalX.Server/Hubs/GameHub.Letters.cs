using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Letters;

namespace PortalX.Server.Hubs;

/// <summary>
/// The private letters of "הצופן הזוגי". These calls never go through the game's action log (its payloads are stored),
/// never broadcast to the room, and never log letter text: the envelope goes to the recipient's own group only, and the
/// text is read by the recipient from <see cref="GetMyLetters"/> — live, or after coming back.
/// </summary>
public sealed partial class GameHub
{
    private static string PlayerGroup(Guid playerId) => "player:" + playerId;

    private LetterService Letters => Context.GetHttpContext()!.RequestServices.GetRequiredService<LetterService>();

    private async Task<HubResult?> LettersClosed(Guid rid)
    {
        var r = await db.Rooms.AsNoTracking().Where(x => x.Id == rid).Select(x => new { x.AccessSource, x.EntitlementId }).FirstOrDefaultAsync();
        return r != null && await rooms.ClosureAsync(r.AccessSource, r.EntitlementId) is { } closure ? new HubResult(false, closure.Code, closure.Message) : null;
    }

    /// <summary>Saves the letter first; only a saved letter is delivered. The same id twice (a double click) is one letter.</summary>
    public async Task<HubResult> SendLetter(string? clientLetterId, string? text, bool keepAlone)
    {
        if (PlayerId is not { } pid || RoomId is not { } rid) return NotConnected();
        if (!Allow("letter", 4, 60)) return TooFast();
        if (await LettersClosed(rid) is { } closed) return closed;
        try
        {
            var sent = await Letters.SendAsync(rid, pid, clientLetterId, text, keepAlone);
            if (!sent.Ok) return new HubResult(false, sent.Code, sent.Message);
            var l = sent.Letter!;
            if (l.RecipientPlayerId is { } to && !sent.Duplicate)
                await Clients.Group(PlayerGroup(to)).SendAsync("letter", new LetterEnvelope(l.Id.ToString("N"), sent.SenderName ?? "", l.CreatedAt, null, l.Round));
            logger.LogInformation("Letter {Letter} saved in room {Room}", l.Id, rid);
            return new HubResult(true, sent.Code, sent.Message, new JsonObject
            {
                ["id"] = l.Id.ToString("N"), ["createdAt"] = l.CreatedAt, ["hasRecipient"] = l.RecipientPlayerId != null,
            });
        }
        catch (Exception ex)
        {
            logger.LogError("Saving a letter failed for room {Room} ({Type})", rid, ex.GetType().Name);
            return new HubResult(false, "server-error", "המכתב לא נשמר. נסו שוב בעוד רגע — מה שכתבתם לא נמחק.");
        }
    }

    /// <summary>The caller's letters: received (with text), the status of the one they sent, and a kept solo letter.</summary>
    public async Task<HubResult> GetMyLetters()
    {
        if (PlayerId is not { } pid || RoomId is not { } rid) return NotConnected();
        if (!Allow("read", 20, 10)) return TooFast();
        var view = await Letters.ViewAsync(rid, pid);
        if (view == null) return new HubResult(false, "not-allowed", "אין מכתבים במשחק הזה.");
        return new HubResult(true, "ok", "", JsonSerializer.SerializeToNode(view, Content.ScenarioCatalog.JsonOptions));
    }

    /// <summary>The envelope reached this screen live: the writer may see that it was delivered.</summary>
    public async Task LetterSeen(string? letterId)
    {
        if (PlayerId is not { } pid || !Guid.TryParse(letterId, out var id)) return;
        if (!Allow("read", 20, 10)) return;
        await Letters.MarkDeliveredAsync(id, pid);
    }

    /// <summary>The recipient opened the letter; the writer's own screens are told (no text, just that it was opened).</summary>
    public async Task<HubResult> OpenLetter(string? letterId)
    {
        if (PlayerId is not { } pid || RoomId is not { } rid) return NotConnected();
        if (!Allow("read", 20, 10)) return TooFast();
        var opened = await Letters.OpenAsync(rid, pid, letterId ?? "");
        if (opened == null) return new HubResult(false, "not-found", "המכתב לא נמצא.");
        await Clients.Group(PlayerGroup(opened.Value.Sender)).SendAsync("letter-opened", new { id = letterId, openedAt = opened.Value.OpenedAt });
        return new HubResult(true, "ok", "");
    }
}
