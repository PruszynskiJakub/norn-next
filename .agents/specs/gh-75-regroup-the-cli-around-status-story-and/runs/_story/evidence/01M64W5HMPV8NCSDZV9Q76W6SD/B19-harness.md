$ (tty, empty title) norn story create
**Usage error (usage):** the title is empty; nothing was created

Do instead: norn story create --title "…"
[exit 2]

asked: ["Title:"]; remote calls: []
$ (tty, title + editor) norn story create
gh-82

Created https://github.com/o/r/issues/82 and took it in; it starts like any new story (`norn status`).
[exit 0]

asked: ["Title:"]; editor opened with: [""]; issue body: "Body from the editor"
