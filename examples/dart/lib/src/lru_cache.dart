/// A least-recently-used cache holding at most [capacity] entries.
class LruCache<K, V> {
  LruCache(this.capacity) : assert(capacity > 0);

  final int capacity;
  // Map literals are insertion ordered, oldest first.
  final _entries = <K, V>{};

  int get length => _entries.length;

  V? operator [](K key) {
    final value = _entries.remove(key);
    if (value != null) _entries[key] = value;
    return value;
  }

  void operator []=(K key, V value) {
    _entries.remove(key);
    _entries[key] = value;
    if (_entries.length > capacity) _entries.remove(_entries.keys.first);
  }
}
