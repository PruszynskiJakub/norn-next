export interface NodeHostOptions {
  /** the checkout's root, handed to plugins as `repo.root` */
  root: string;
  /** the machine folder for this repo, handed to plugins as `repo.dataDir` */
  dataDir: string;
}
