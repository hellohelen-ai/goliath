import { checkAbort } from "../../context.js";
import { filePath, normalizePath, pageLimit, within } from "../paths.js";
import type { FileInfo, FilesystemBackend, FilesystemRoute } from "../types.js";

type Mount = { prefix: string; backend: FilesystemBackend; readOnly: boolean };

export function compositeFilesystem(options: {
  default: FilesystemBackend;
  routes?: Record<string, FilesystemRoute>;
}): FilesystemBackend {
  const mounts: Mount[] = [{ prefix: "/", backend: options.default, readOnly: false }];
  const used = new Set(["/"]);
  for (const [path, value] of Object.entries(options.routes ?? {})) {
    const prefix = normalizePath(path);
    if (used.has(prefix)) throw new Error(`Duplicate route: ${prefix}. Use default for the root.`);
    used.add(prefix);
    const route = "backend" in value ? value : { backend: value };
    mounts.push({ prefix, backend: route.backend, readOnly: route.readOnly ?? false });
  }
  mounts.sort((a, b) => b.prefix.length - a.prefix.length);
  const resolve = (path: string) => mounts.find(({ prefix }) => within(path, prefix))!;
  const local = (path: string, mount: Mount) =>
    mount.prefix === "/" ? path : path.slice(mount.prefix.length) || "/";
  const external = (path: string, mount: Mount) =>
    mount.prefix === "/" ? path : `${mount.prefix}${path === "/" ? "" : path}`;

  return {
    async read(path, signal) {
      const key = filePath(path);
      const mount = resolve(key);
      const entry = await mount.backend.read(local(key, mount), signal);
      return { ...entry, path: key };
    },
    async list(path, query = {}) {
      const root = normalizePath(path);
      const limit = pageLimit(query.limit);
      const candidates: FileInfo[] = [];
      for (const mount of mounts) {
        if (!within(root, mount.prefix) && !within(mount.prefix, root)) continue;
        const directory = within(root, mount.prefix) ? local(root, mount) : "/";
        let after =
          query.after && within(query.after, mount.prefix) ? local(query.after, mount) : undefined;
        let visible = 0;
        for (;;) {
          checkAbort(query.signal);
          const page = await mount.backend.list(directory, {
            limit: Math.min(256, limit + 1),
            ...(after ? { after } : {}),
            ...(query.signal ? { signal: query.signal } : {}),
          });
          for (const file of page.files) {
            const key = external(filePath(file.path), mount);
            if (resolve(key) !== mount || !within(key, root) || key <= (query.after ?? ""))
              continue;
            candidates.push({ ...file, path: key });
            visible++;
          }
          if (!page.next || visible > limit) break;
          if (page.next <= (after ?? ""))
            throw new Error("Backend listing cursor did not advance.");
          after = page.next;
        }
      }
      candidates.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      const files = candidates.slice(0, limit);
      return { files, next: candidates.length > limit ? files.at(-1)!.path : null };
    },
    async write(path, content, query) {
      const key = filePath(path);
      const mount = resolve(key);
      if (mount.readOnly || !mount.backend.write)
        throw new Error(`Read-only route: ${mount.prefix}`);
      const entry = await mount.backend.write(local(key, mount), content, query);
      return { ...entry, path: key };
    },
    async remove(path, query) {
      const key = filePath(path);
      const mount = resolve(key);
      if (mount.readOnly || !mount.backend.remove)
        throw new Error(`Read-only route: ${mount.prefix}`);
      await mount.backend.remove(local(key, mount), query);
    },
  };
}
