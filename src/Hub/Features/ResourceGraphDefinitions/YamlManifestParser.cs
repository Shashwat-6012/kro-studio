using System.Globalization;
using System.Text.Json;
using YamlDotNet.RepresentationModel;

namespace KroStudio.Web.Features.ResourceGraphDefinitions;

/// <summary>Parses one YAML document into JSON without dropping unknown Kubernetes fields.</summary>
public static class YamlManifestParser
{
    /// <summary>Parses a YAML mapping into a JSON object for Kubernetes API operations.</summary>
    public static JsonElement Parse(string yaml)
    {
        if (string.IsNullOrWhiteSpace(yaml))
        {
            throw new ArgumentException("A YAML manifest is required.", nameof(yaml));
        }
        YamlStream stream = new();
        try
        {
            stream.Load(new StringReader(yaml));
        }
        catch (YamlDotNet.Core.YamlException exception)
        {
            throw new ArgumentException($"YAML could not be parsed: {exception.Message}", nameof(yaml), exception);
        }
        if (stream.Documents.Count != 1 || stream.Documents[0].RootNode is not YamlMappingNode)
        {
            throw new ArgumentException("Provide exactly one YAML document with an object at its root.", nameof(yaml));
        }
        object? value = ConvertNode(stream.Documents[0].RootNode, 0);
        return JsonSerializer.SerializeToElement(value);
    }

    private static object? ConvertNode(YamlNode node, int depth)
    {
        if (depth > 64)
        {
            throw new ArgumentException("YAML nesting exceeds the supported depth of 64.", nameof(node));
        }
        if (node is YamlMappingNode mapping)
        {
            Dictionary<string, object?> values = new(StringComparer.Ordinal);
            foreach (KeyValuePair<YamlNode, YamlNode> entry in mapping.Children)
            {
                if (entry.Key is not YamlScalarNode key || key.Value is null)
                {
                    throw new ArgumentException("Manifest mapping keys must be strings.", nameof(node));
                }
                if (!values.TryAdd(key.Value, ConvertNode(entry.Value, depth + 1)))
                {
                    throw new ArgumentException($"Manifest contains the duplicate key '{key.Value}'.", nameof(node));
                }
            }
            return values;
        }
        if (node is YamlSequenceNode sequence)
        {
            return sequence.Children.Select(child => ConvertNode(child, depth + 1)).ToArray();
        }
        if (node is YamlScalarNode scalar)
        {
            if (scalar.Style == YamlDotNet.Core.ScalarStyle.Plain)
            {
                if (scalar.Value is null || scalar.Value is "null" or "Null" or "NULL" or "~")
                {
                    return null;
                }
                if (bool.TryParse(scalar.Value, out bool boolean))
                {
                    return boolean;
                }
                if (long.TryParse(scalar.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out long integer))
                {
                    return integer;
                }
                if (double.TryParse(scalar.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out double number) && double.IsFinite(number))
                {
                    return number;
                }
            }
            return scalar.Value;
        }
        throw new ArgumentException("Unsupported YAML node in manifest.", nameof(node));
    }
}
