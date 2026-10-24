import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const workflow = readFileSync(
  new URL("../../.github/workflows/release-archive.yml", import.meta.url),
  "utf8",
);
const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const dependency = readFileSync(
  new URL("../../.github/workflows/dependency-review.yml", import.meta.url),
  "utf8",
);
// Extract and execute the actual inline scripts, rather than a parallel guard implementation.
function scriptFor(name) {
  const start = workflow.indexOf(`- name: ${name}\n`);
  assert(start !== -1);
  const script = workflow.slice(start).split("          script: |\n")[1];
  const lines = [];
  for (const line of script.split("\n")) {
    if (line && !line.startsWith("            ")) break;
    lines.push(line.slice(12));
  }
  return lines.join("\n");
}
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const guard = new AsyncFunction(
  "require",
  "github",
  "context",
  "core",
  "process",
  scriptFor("Validate release authority and candidate bytes"),
);
const publish = new AsyncFunction(
  "require",
  "github",
  "context",
  "core",
  "process",
  "fetch",
  scriptFor("Upload a draft, publish once, and verify public bytes"),
);
const nativeRequire = createRequire(import.meta.url);
const sha = "a".repeat(40);
const version = "0.1.0-beta.6";
const filename = `ponchia-visual-models-${version}.tgz`;
const bytes = Buffer.from("fixture archive bytes; tar metadata is injected");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const metadata = { name: "@ponchia/visual-models", version };
const response = (data) => Promise.resolve({ data });
const missing = () => Promise.reject(Object.assign(new Error("Not Found"), { status: 404 }));

function fixture() {
  const files = new Map([
    [`candidate/${filename}`, bytes],
    ["signed-bundle", Buffer.from("signed fixture")],
  ]);
  const effects = [];
  const state = {
    files,
    effects,
    names: [filename],
    embedded: metadata,
    context: {
      repo: { owner: "Ponchia", repo: "bronto-visual-models" },
      eventName: "push",
      ref: `refs/tags/v${version}`,
      sha,
      payload: { created: true, deleted: false, repository: { private: false, fork: false } },
      serverUrl: "https://github.com",
      runId: 123,
    },
    process: {
      env: {
        RELEASE_ENABLED: "true",
        EXPECTED_SHA256: sha256,
        PROVENANCE_BUNDLE: "signed-bundle",
        QUALIFICATION: JSON.stringify(
          Object.fromEntries(
            ["package", "core", "browser", "distribution"].map((job) => [
              job,
              { result: "success" },
            ]),
          ),
        ),
      },
    },
    core: {
      setOutput() {},
      summary: {
        addHeading() {
          return this;
        },
        addLink() {
          return this;
        },
        addRaw() {
          return this;
        },
        async write() {
          effects.push("summary");
        },
      },
    },
  };
  const immutable = {
    bypass_actors: [],
    conditions: { ref_name: { include: ["refs/tags/v*"], exclude: [] } },
    rules: [{ type: "update" }, { type: "deletion" }],
  };
  state.rule = immutable;
  state.environment = {
    can_admins_bypass: false,
    protection_rules: [
      { type: "required_reviewers", prevent_self_review: true, reviewers: [{ type: "User" }] },
    ],
    deployment_branch_policy: { custom_branch_policies: true },
  };
  state.policies = { total_count: 1, branch_policies: [{ type: "tag", name: "v0.1.0-beta.*" }] };
  const rules = () => [{ id: 1, target: "tag", enforcement: "active" }];
  const assets = () => [
    { name: filename, browser_download_url: "https://github.com/fixture/archive" },
  ];
  state.github = {
    rest: {
      git: {
        getRef: () => response({ object: { type: "commit", sha } }),
        getTag: () => response({ object: { type: "commit", sha } }),
      },
      repos: {
        getEnvironment: () => response(state.environment),
        listDeploymentBranchPolicies: () => response(state.policies),
        compareCommitsWithBasehead: () => response({ status: "identical" }),
        getRepoRulesets: rules,
        listReleaseAssets: assets,
        getRepoRuleset: () => response(state.rule),
        getReleaseByTag: missing,
        getContent: () =>
          response({ content: Buffer.from(JSON.stringify(metadata)).toString("base64") }),
        createRelease: async (input) => {
          effects.push(["create", input]);
          return { data: { id: 7 } };
        },
        uploadReleaseAsset: async (input) => {
          effects.push(["upload", input.name]);
        },
        updateRelease: async (input) => {
          effects.push(["publish", input]);
          return {
            data: {
              id: 7,
              immutable: true,
              draft: false,
              prerelease: true,
              tag_name: `v${version}`,
              html_url: "https://github.com/fixture/release",
            },
          };
        },
      },
    },
    paginate: async (method, args) => method(args),
  };
  state.require = (name) => {
    if (name === "node:fs")
      return {
        readdirSync: () => state.names,
        lstatSync: () => ({ isFile: () => true }),
        readFileSync: (path) => {
          assert(files.has(path), `Missing fixture ${path}`);
          return files.get(path);
        },
        writeFileSync: (path, data) => files.set(path, data),
        copyFileSync: (source, target) => {
          assert(files.has(source));
          files.set(target, files.get(source));
        },
      };
    if (name === "node:child_process")
      return {
        execFileSync: (command, args) => {
          assert.equal(command, "tar");
          assert.deepEqual(args, ["-xOf", `candidate/${filename}`, "package/package.json"]);
          if (state.tarFailure) throw new Error("tar failed");
          return JSON.stringify(state.embedded);
        },
      };
    return nativeRequire(name);
  };
  state.guard = () => guard(state.require, state.github, state.context, state.core, state.process);
  state.publish = () =>
    publish(state.require, state.github, state.context, state.core, state.process, state.fetch);
  state.fetch = async () => new Response(bytes);
  return state;
}

test("valid beta on main passes the actual publisher guard", async () => {
  const state = fixture();
  await state.guard();
  assert.equal(JSON.parse(state.files.get("candidate/release-evidence.json")).sha256, sha256);
  assert.deepEqual(state.effects, []);
});

const refusals = {
  "environment with administrator bypass": (state) => {
    state.environment.can_admins_bypass = true;
  },
  "environment with unknown administrator bypass": (state) => {
    delete state.environment.can_admins_bypass;
  },
  "environment without required review": (state) => {
    state.environment.protection_rules = [];
  },
  "environment permitting self-review": (state) => {
    state.environment.protection_rules[0].prevent_self_review = false;
  },
  "environment without custom policies": (state) => {
    state.environment.deployment_branch_policy.custom_branch_policies = false;
  },
  "environment branch access": (state) => {
    state.policies.branch_policies[0].type = "branch";
  },
  "environment broad tag access": (state) => {
    state.policies.branch_policies[0].name = "*";
  },
  "environment extra policies": (state) => {
    state.policies.total_count = 2;
  },
  "automation disabled": (state) => {
    state.process.env.RELEASE_ENABLED = "false";
  },
  "pull request event": (state) => {
    state.context.eventName = "pull_request";
  },
  "workflow dispatch": (state) => {
    state.context.eventName = "workflow_dispatch";
  },
  "fork repository": (state) => {
    state.context.repo.owner = "attacker";
  },
  "private repository": (state) => {
    state.context.payload.repository.private = true;
  },
  "fork payload": (state) => {
    state.context.payload.repository.fork = true;
  },
  "updated tag event": (state) => {
    state.context.payload.created = false;
  },
  "deleted tag": (state) => {
    state.context.payload.deleted = true;
  },
  "branch ref": (state) => {
    state.context.ref = "refs/heads/main";
  },
  "stable ref": (state) => {
    state.context.ref = "refs/tags/v0.1.0";
  },
  "development ref": (state) => {
    state.context.ref = "refs/tags/v0.1.0-beta.6-dev.0";
  },
  "shell injection ref": (state) => {
    state.context.ref = "refs/tags/v0.1.0-beta.6;$(touch /tmp/untrusted)";
  },
  "path ref": (state) => {
    state.context.ref = "refs/tags/v0.1.0-beta.6/extra";
  },
  "tag moved": (state) => {
    state.github.rest.git.getRef = () =>
      response({ object: { type: "commit", sha: "b".repeat(40) } });
  },
  "off main": (state) => {
    state.github.rest.repos.compareCommitsWithBasehead = () => response({ status: "diverged" });
  },
  "main behind candidate": (state) => {
    state.github.rest.repos.compareCommitsWithBasehead = () => response({ status: "behind" });
  },
  "existing release": (state) => {
    state.github.rest.repos.getReleaseByTag = () => response({ id: 7 });
  },
  "release API error": (state) => {
    state.github.rest.repos.getReleaseByTag = () =>
      Promise.reject(Object.assign(new Error("server error"), { status: 500 }));
  },
  "unreadable rules": (state) => {
    state.github.rest.repos.getRepoRuleset = () => Promise.reject(new Error("unreadable"));
  },
  "rules with bypass": (state) => {
    state.rule.bypass_actors.push({ actor_id: 1 });
  },
  "rules excluding tags": (state) => {
    state.rule.conditions.ref_name.exclude.push("refs/tags/v0.1.0-beta.*");
  },
  "unprotected tags": (state) => {
    state.rule.conditions.ref_name.include = ["refs/tags/other*"];
  },
  "missing update restriction": (state) => {
    state.rule.rules = [{ type: "deletion" }];
  },
  "no rulesets": (state) => {
    state.github.rest.repos.getRepoRulesets = () => [];
  },
  "archive missing": (state) => {
    state.names = [];
  },
  "archive ambiguous": (state) => {
    state.names.push("extra.tgz");
  },
  "wrong archive version": (state) => {
    state.embedded = { ...metadata, version: "0.1.0-beta.7" };
  },
  "wrong archive name": (state) => {
    state.embedded = { ...metadata, name: "@other/package" };
  },
  "archive checksum mismatch": (state) => {
    state.process.env.EXPECTED_SHA256 = "b".repeat(64);
  },
  "checksum missing": (state) => {
    delete state.process.env.EXPECTED_SHA256;
  },
  "tar extraction failed": (state) => {
    state.tarFailure = true;
  },
};
for (const [name, mutate] of Object.entries(refusals)) {
  test(`refuses ${name} without publishing`, async () => {
    const state = fixture();
    mutate(state);
    await assert.rejects(state.guard());
    assert.deepEqual(state.effects, []);
  });
}
for (const job of ["package", "core", "browser", "distribution"]) {
  for (const result of ["skipped", "failure", "cancelled", undefined]) {
    test(`refuses ${job} ${result} qualification`, async () => {
      const state = fixture();
      const qualification = JSON.parse(state.process.env.QUALIFICATION);
      qualification[job].result = result;
      state.process.env.QUALIFICATION = JSON.stringify(qualification);
      await assert.rejects(state.guard());
    });
  }
}
test("annotated tags are peeled to the exact source", async () => {
  const state = fixture();
  state.github.rest.git.getRef = () => response({ object: { type: "tag", sha: "c".repeat(40) } });
  await state.guard();
});
test("uploads all assets before publishing a prerelease without changing latest", async () => {
  const state = fixture();
  await state.guard();
  await state.publish();
  assert.deepEqual(
    state.effects.map((effect) => (Array.isArray(effect) ? effect[0] : effect)),
    ["create", "upload", "upload", "upload", "upload", "publish", "summary"],
  );
  const creation = state.effects[0][1];
  assert.equal(creation.draft, true);
  assert.equal(creation.prerelease, true);
  assert.equal(creation.make_latest, "false");
});
test("upload errors propagate and leave the draft unpublished", async () => {
  const state = fixture();
  await state.guard();
  state.github.rest.repos.uploadReleaseAsset = async () => {
    throw new Error("upload failed");
  };
  await assert.rejects(state.publish(), /upload failed/);
  assert.equal(
    state.effects.some((effect) => effect[0] === "publish"),
    false,
  );
});
test("an interrupted asset upload retains its accepted draft identity", async () => {
  const state = fixture();
  await state.guard();
  const upload = state.github.rest.repos.uploadReleaseAsset;
  let uploaded = 0;
  state.github.rest.repos.uploadReleaseAsset = async (input) => {
    if (uploaded++ === 1) throw new Error("second upload failed");
    return upload(input);
  };
  await assert.rejects(state.publish(), /second upload failed/);
  const receipt = JSON.parse(state.files.get("candidate/publication-receipt.json"));
  assert.equal(receipt.releaseId, 7);
  assert.equal(receipt.phase, "draft-created");
  assert.deepEqual(receipt.uploaded, [filename]);
  assert.equal(state.effects.filter((effect) => effect[0] === "create").length, 1);
  assert.equal(
    state.effects.some((effect) => effect[0] === "publish"),
    false,
  );
});
for (const immutable of [false, undefined]) {
  test(`does not report successful delivery when immutability is ${immutable}`, async () => {
    const state = fixture();
    await state.guard();
    const update = state.github.rest.repos.updateRelease;
    state.github.rest.repos.updateRelease = async (input) => {
      const result = await update(input);
      result.data.immutable = immutable;
      return result;
    };
    await assert.rejects(state.publish(), /not confirmed immutable/);
    const receipt = JSON.parse(state.files.get("candidate/publication-receipt.json"));
    assert.equal(receipt.releaseId, 7);
    assert.equal(receipt.phase, "publication-response");
    assert.equal(receipt.draft, false);
    assert.equal(receipt.immutable, immutable);
    assert.equal(state.effects.filter((effect) => effect[0] === "publish").length, 1);
    assert.equal(state.files.has("candidate/published-verification.json"), false);
  });
}
test("a verified delivery retains its immutable publication receipt", async () => {
  const state = fixture();
  await state.guard();
  await state.publish();
  const receipt = JSON.parse(state.files.get("candidate/publication-receipt.json"));
  assert.equal(receipt.releaseId, 7);
  assert.equal(receipt.publishedReleaseId, 7);
  assert.equal(receipt.immutable, true);
  assert.equal(receipt.uploaded.length, 4);
  assert.equal(
    JSON.parse(state.files.get("candidate/published-verification.json")).immutable,
    true,
  );
});
test("tag moving during signing prevents release creation", async () => {
  const state = fixture();
  await state.guard();
  state.github.rest.git.getRef = () =>
    response({ object: { type: "commit", sha: "b".repeat(40) } });
  await assert.rejects(state.publish(), /Tag changed/);
  assert.deepEqual(state.effects, []);
});
test("public corruption fails verification after publication", async () => {
  const state = fixture();
  await state.guard();
  state.fetch = async () => new Response("different bytes");
  await assert.rejects(state.publish());
  assert(state.effects.some((effect) => effect[0] === "publish"));
});
test("workflow boundaries preserve qualification and keep publication isolated", () => {
  assert.match(ci, /release-archive:[\s\S]*needs: \[package, core, browser, distribution\]/);
  assert.match(
    ci,
    /Prepare Pages artifact\n\s+if: matrix.browser == 'chromium' && github.ref == 'refs\/heads\/main' && github.event_name == 'push'/,
  );
  assert.match(
    ci,
    /Publish verified demo\n\s+if: github.ref == 'refs\/heads\/main' && github.event_name == 'push'/,
  );
  assert.match(workflow, /environment: github-release/);
  assert.doesNotMatch(workflow, /actions\/checkout|^\s+- run:|npm (publish|install|ci|pack)/m);
  assert.match(dependency, /branches: \[main\]/);
  assert.match(dependency, /fail-on-severity: high/);
  assert.doesNotMatch(dependency, /actions\/checkout|\brun:|pull_request_target|write/);
  for (const file of [ci, workflow, dependency]) {
    for (const match of file.matchAll(/uses: (actions\/[^\s]+)/g))
      assert.match(match[1], /@[a-f0-9]{40}$/);
  }
});
