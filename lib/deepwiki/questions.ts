// DeepWiki 提问模板。
//
// 设计原则(实测得出,见 docs/deepwiki-redesign.md §2.3):
// DeepWiki 的**事实**很硬(文件路径、代码引文、依赖名都准),**判断**很飘
// (next.js 因一句 process.platform 被判"已鸿蒙化";sqlite 的 VFS 被判"无平台抽象层")。
// 所以这里的问题一律只问「有什么、在哪、原文是什么」,绝不问「难不难、值不值得」——
// 那些交给我们自己的 LLM 依据这些事实去判。
//
// 改动本文件的任何问题文本都必须 bump QUESTION_VERSION,否则旧结果不会失效。

/** 提问版本;参与 input_hash,bump 后下次管道会重新问。 */
export const QUESTION_VERSION = 'q2';

/** 所有问题共用的输出纪律。实测「不要编造路径」这句显著有效(5 个反例中 4 个正确返回空数组)。 */
const OUTPUT_DISCIPLINE = [
  'Answer ONLY with a single JSON object. No prose, no explanation, no markdown code fences.',
  'Every path you list MUST be a real path you actually found in the repository.',
  'If you find nothing for a field, return an empty array or null — do NOT invent or guess paths.',
  'Do not describe what the project could hypothetically do; only report what is in the code.',
].join(' ');

/**
 * Q1 鸿蒙证据问 —— 这个仓库**已经**有多少鸿蒙化痕迹?
 *
 * 只收集证据,不让它下"已适配"的结论 —— 分级由 lib/harmony/signals.ts 和 LLM 做。
 */
export const HARMONY_EVIDENCE_QUESTION = `${OUTPUT_DISCIPLINE}

Search this repository for any HarmonyOS / OpenHarmony related code or configuration. Look specifically for: directories named OpenHarmony/ohos/harmony, files named oh-package.json5, build-profile.json5, module.json5, hvigorfile.ts, any .ets (ArkTS) source files, imports of @ohos.* modules, and any string literals mentioning "openharmony", "harmonyos" or "ohos".

Return this JSON shape:
{
  "harmony_paths": [string],
  "harmony_quote": string|null,
  "harmony_scope": "dedicated_port"|"build_target_only"|"incidental_mention"|"none",
  "declares_harmony_support": boolean,
  "ohos_imports": [string]
}

Field meanings — read carefully, this distinction matters:
- "dedicated_port": there is a real HarmonyOS implementation (an OpenHarmony/ directory, ArkTS sources, oh-package.json5 with actual code behind it).
- "build_target_only": OpenHarmony appears merely as one entry in a build/platform matrix or a napi target list, with no dedicated implementation.
- "incidental_mention": the words appear only in docs, changelogs, comments, or a single platform string comparison.
- "none": nothing found. Then harmony_paths must be [] and harmony_quote must be null.
- "declares_harmony_support": true only if the README or official docs explicitly claim HarmonyOS/OpenHarmony support.`;

/**
 * Q2 移植面问 —— 如果要移植,代码里哪些地方是障碍、哪些地方是抓手?
 *
 * 注意只问事实(路径/依赖名/占比),不问 effort 分级。
 */
export const PORTING_SURFACE_QUESTION = `${OUTPUT_DISCIPLINE}

Analyze what this repository's code would require in order to run on a new OS platform. Report facts only, no difficulty ratings.

Return this JSON shape:
{
  "project_type": "library"|"framework"|"application"|"tool"|"docs"|"other",
  "languages": [string],
  "native_code_ratio": number,
  "has_platform_abstraction": boolean,
  "platform_layer_paths": [string],
  "existing_platform_backends": [string],
  "portable_core_paths": [string],
  "blocking_deps": [{"name": string, "why": string}],
  "platform_apis_used": [string],
  "conditional_compilation": [string]
}

Field meanings:
- "native_code_ratio": approximate share of C/C++/Rust/ObjC/Swift/Java/Kotlin code, 0 to 1.
- "has_platform_abstraction" / "platform_layer_paths": does the code isolate per-OS behaviour behind an interface that a new backend could be added to? Give the concrete files or directories that implement it. A VFS layer, an os_*.c family, a platform/ directory, or a set of per-OS implementations of one interface all count.
- "existing_platform_backends": which platforms already have a backend in that layer (e.g. "posix", "win32", "android", "darwin").
- "portable_core_paths": directories that are pure logic with no OS coupling.
- "blocking_deps": third-party dependencies that are bound to a specific OS, GUI toolkit, or hardware and would not build elsewhere. Give the real dependency name and one clause on why.
- "platform_apis_used": OS-level API families the code calls directly (e.g. "POSIX file I/O", "Win32 registry", "UIKit", "JNI", "epoll").
- "conditional_compilation": the actual macro or flag names used to switch platforms (e.g. "__APPLE__", "_WIN32", "TARGET_OS_IOS").`;

/** tier-2 的两问(每仓 ~15s)。 */
export const TIER2_QUESTIONS = [
  { key: 'harmony_evidence', question: HARMONY_EVIDENCE_QUESTION },
  { key: 'porting_surface', question: PORTING_SURFACE_QUESTION },
] as const;

/**
 * tier-3 深度问询:在 tier-2 两问之上,再按子系统逐个拆解。
 * 每问仍只收事实;最终由一次 LLM 调用汇总定级。
 */
export const TIER3_QUESTIONS = [
  ...TIER2_QUESTIONS,
  {
    key: 'build_system',
    question: `${OUTPUT_DISCIPLINE}

Describe this repository's build system and how a new target platform would be added to it.

Return: {"build_tools": [string], "build_entry_files": [string], "target_platform_declarations": [string], "how_targets_are_added": string, "cross_compilation_support": boolean, "toolchain_requirements": [string]}

"target_platform_declarations" must be real paths where the set of supported platforms is enumerated.`,
  },
  {
    key: 'native_bridge',
    question: `${OUTPUT_DISCIPLINE}

Report how this repository crosses the native/managed boundary, if at all.

Return: {"bridge_mechanisms": [string], "bridge_paths": [string], "exported_native_api_surface": string|null, "binding_generator": string|null, "has_ffi": boolean}

"bridge_mechanisms" should name real mechanisms found in the code (e.g. "JNI", "NAPI", "N-API", "cgo", "PyO3", "wasm-bindgen", "SWIG"). If the project is pure script with no native layer, return empty arrays and false.`,
  },
  {
    key: 'ui_layer',
    question: `${OUTPUT_DISCIPLINE}

Report this repository's UI/rendering layer, if it has one.

Return: {"has_ui": boolean, "ui_frameworks": [string], "ui_paths": [string], "rendering_backends": [string], "is_ui_pluggable": boolean, "ui_entry_points": [string]}

"rendering_backends" means concrete backends present in the code (e.g. "OpenGL", "Vulkan", "Metal", "Skia", "DOM", "Canvas"). If the project has no UI at all, set has_ui=false and return empty arrays.`,
  },
  {
    key: 'io_layer',
    question: `${OUTPUT_DISCIPLINE}

Report how this repository does networking, storage, threading and process management.

Return: {"network_stack": [string], "storage_mechanisms": [string], "concurrency_model": string|null, "io_abstraction_paths": [string], "uses_raw_syscalls": boolean, "syscall_examples": [string]}

Name real libraries and real paths found in the code.`,
  },
  {
    key: 'license_and_health',
    question: `${OUTPUT_DISCIPLINE}

Report this repository's licensing and any constraints on reuse.

Return: {"license": string|null, "license_path": string|null, "vendored_third_party": [string], "conflicting_licenses": [string], "patent_or_trademark_notes": string|null}

"vendored_third_party" means third-party source copied into this repo (give directory paths). Report only what is actually in the repository.`,
  },
] as const;

export type QuestionKey = (typeof TIER3_QUESTIONS)[number]['key'];
