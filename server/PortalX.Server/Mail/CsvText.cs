using System.Globalization;

namespace PortalX.Server.Mail;

/// <summary>One CSV cell for the admin exports: dates in UTC, yes/no in Hebrew, and no spreadsheet formulas from user data.</summary>
public static class CsvText
{
    public static string Cell(object? v)
    {
        var s = v switch
        {
            null => "",
            DateTime d => d.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) + " UTC",
            bool b => b ? "כן" : "לא",
            IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
            _ => v.ToString() ?? "",
        };
        // a cell that a spreadsheet would run as a formula starts with a quote instead
        if (s.Length > 0 && "=+-@\t\r".Contains(s[0])) s = "'" + s;
        return s.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? "\"" + s.Replace("\"", "\"\"") + "\"" : s;
    }
}
