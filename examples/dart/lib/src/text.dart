/// Counts how often each word appears in [text], ignoring case.
Map<String, int> wordFrequencies(String text) {
  final counts = <String, int>{};
  for (final match in RegExp(r"[A-Za-z']+").allMatches(text)) {
    final word = match[0]!.toLowerCase();
    counts[word] = (counts[word] ?? 0) + 1;
  }
  return counts;
}

/// Builds a comma separated list of [count] numbers.
String joinNumbers(int count) {
  final buffer = StringBuffer();
  for (var i = 0; i < count; i++) {
    if (i > 0) buffer.write(',');
    buffer.write(i);
  }
  return buffer.toString();
}
