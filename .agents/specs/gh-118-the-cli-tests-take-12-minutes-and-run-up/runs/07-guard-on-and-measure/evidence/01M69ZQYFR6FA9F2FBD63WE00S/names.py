import sys, re, collections, xml.etree.ElementTree as ET
def names(paths):
    c = collections.Counter()
    for p in paths:
        for tc in ET.parse(p).getroot().iter('testcase'):
            c[(tc.get('classname') or '') + ' > ' + tc.get('name')] += 1
    return c
base = names(sys.argv[1].split(',')); head = names(sys.argv[2].split(','))
print("base", sum(base.values()), "head", sum(head.values()))
added = head - base; removed = base - head
print("added", sum(added.values()), "removed", sum(removed.values()))
for k, v in sorted(added.items()): print(f"+ {v} {k}")
for k, v in sorted(removed.items()): print(f"- {v} {k}")
