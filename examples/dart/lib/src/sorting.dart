/// Sorts [list] in place with insertion sort.
void insertionSort(List<int> list) {
  for (var i = 1; i < list.length; i++) {
    final value = list[i];
    var j = i - 1;
    while (j >= 0 && list[j] > value) {
      list[j + 1] = list[j];
      j--;
    }
    list[j + 1] = value;
  }
}

/// Returns a sorted copy of [list], using merge sort.
List<int> mergeSort(List<int> list) {
  if (list.length <= 1) return List.of(list);
  final middle = list.length ~/ 2;
  final left = mergeSort(list.sublist(0, middle));
  final right = mergeSort(list.sublist(middle));
  final result = <int>[];
  var i = 0, j = 0;
  while (i < left.length && j < right.length) {
    result.add(left[i] <= right[j] ? left[i++] : right[j++]);
  }
  return result
    ..addAll(left.skip(i))
    ..addAll(right.skip(j));
}
