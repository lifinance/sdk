#!/usr/bin/env node
// Oxc migration helper. It brings a file tree to the Oxlint and Oxfmt layout
// of `main` in three steps: `sort` (import specifiers), `format` (Oxfmt) and
// `convert` (old suppression comments to `oxlint-disable` directives).
//
// Usage: node scripts/oxc-migrate-branch.mjs [--step sort|format|convert]
//        [--as <repository path>] [file...]
//
// Run it from the repository root. It installs pinned tool versions into a
// cache folder outside the repository, so it also works on old branches.
// Remove this file when no branch from before the migration remains.
import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from 'node:path'
import { pathToFileURL } from 'node:url'

export const TOOL_VERSIONS = {
  oxlint: '1.93.0',
  oxfmt: '0.78.0',
  'oxc-parser': '0.158.0',
}

const SELF = 'scripts/oxc-migrate-branch.mjs'
const SORT_CONFIG = '.oxlintrc.sort-imports.tmp.json'
const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/
const STEPS = ['sort', 'format', 'convert']

// A per-user folder: the script runs the tools in it, so a shared temporary
// folder is not safe.
export const cacheDir = (env = process.env) =>
  env.OXC_MIGRATE_CACHE_DIR ||
  join(
    env.XDG_CACHE_HOME || join(homedir(), '.cache'),
    `oxc-migrate-branch-${Object.entries(TOOL_VERSIONS)
      .map(([name, version]) => `${name}-${version}`)
      .join('-')}`
  )

function toolsWork(cache) {
  const bin = (name) => join(cache, 'node_modules', '.bin', name)
  if (!existsSync(bin('oxlint')) || !existsSync(bin('oxfmt'))) {
    return false
  }
  const works = (name) =>
    spawnSync(bin(name), ['--version'], { encoding: 'utf8' }).stdout?.includes(
      TOOL_VERSIONS[name]
    )
  if (!works('oxlint') || !works('oxfmt')) {
    return false
  }
  try {
    createRequire(join(cache, 'package.json')).resolve('oxc-parser')
    return true
  } catch {
    return false
  }
}

// One check of the tool cache for each cache folder and process.
const toolsByCache = new Map()

export function ensureTools() {
  const cache = cacheDir()
  if (!toolsByCache.has(cache)) {
    const tools = loadTools(cache)
    tools.catch(() => toolsByCache.delete(cache))
    toolsByCache.set(cache, tools)
  }
  return toolsByCache.get(cache)
}

async function loadTools(cache) {
  const bin = (name) => join(cache, 'node_modules', '.bin', name)
  if (!toolsWork(cache)) {
    // A missing or broken cache folder: install the tools again.
    rmSync(cache, { recursive: true, force: true })
    mkdirSync(dirname(cache), { recursive: true })
    const staging = `${cache}.tmp-${process.pid}`
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })
    writeFileSync(join(staging, 'package.json'), '{"private":true}\n')
    execFileSync(
      'npm',
      [
        'install',
        '--no-save',
        '--no-audit',
        '--no-fund',
        '--no-package-lock',
        '--ignore-scripts',
        ...Object.entries(TOOL_VERSIONS).map(
          ([name, version]) => `${name}@${version}`
        ),
      ],
      { cwd: staging, stdio: 'pipe' }
    )
    try {
      renameSync(staging, cache)
    } catch (error) {
      // Another process installed the tools first. Use its copy.
      rmSync(staging, { recursive: true, force: true })
      if (!toolsWork(cache)) {
        throw new Error(
          `cannot install the tools into ${cache} (${error.message}). Delete the folder and run again.`
        )
      }
    }
  }
  const require = createRequire(join(cache, 'package.json'))
  const parser = await import(pathToFileURL(require.resolve('oxc-parser')).href)
  return {
    oxlintBin: bin('oxlint'),
    oxfmtBin: bin('oxfmt'),
    parseSync: parser.parseSync,
  }
}

// A path relative to the root, or undefined for a path outside the root.
export function repoPath(root, file) {
  const path = relative(root, resolve(root, file))
  if (path === '') {
    return '.'
  }
  return !path.startsWith('..') && !isAbsolute(path) ? path : undefined
}

// Tracked and untracked files that Git does not ignore and that are on disk.
const gitFiles = (root, paths) =>
  execFileSync(
    'git',
    [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      ...paths,
    ],
    { cwd: root, encoding: 'utf8' }
  )
    .split('\0')
    .filter((file) => file && existsSync(join(root, file)))

const isFolder = (path) => existsSync(path) && statSync(path).isDirectory()

// Source files to sort and convert: the given files, the files in the
// given folders, or all files that Git does not ignore. Each file comes once.
export function listTargetFiles(root, files) {
  const candidates = files.length
    ? files.flatMap((file) => {
        const path = repoPath(root, file) ?? file
        return isFolder(resolve(root, path)) ? gitFiles(root, [path]) : [path]
      })
    : gitFiles(root, [])
  return [
    ...new Set(
      candidates.filter((file) => SOURCE_FILE.test(file) && file !== SELF)
    ),
  ]
}

function run(bin, args, cwd) {
  const result = spawnSync(bin, args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(
      `${bin} ${args.join(' ')} exited with ${result.status}\n${result.stdout}${result.stderr}`
    )
  }
  return result.stdout
}

export async function runSort(root, files) {
  const { oxlintBin } = await ensureTools()
  const config = JSON.parse(readFileSync(join(root, '.oxlintrc.json'), 'utf8'))
  const sortImports = config.rules?.['sort-imports']
  if (!sortImports) {
    throw new Error('.oxlintrc.json has no sort-imports rule')
  }
  const sortConfig = {
    categories: { correctness: 'off' },
    rules: { 'sort-imports': sortImports },
    ignorePatterns: config.ignorePatterns ?? [],
  }
  const targets = files.length ? listTargetFiles(root, files) : []
  if (files.length && !targets.length) {
    return
  }
  writeFileSync(join(root, SORT_CONFIG), `${JSON.stringify(sortConfig)}\n`)
  try {
    run(
      oxlintBin,
      [
        '-c',
        SORT_CONFIG,
        '--fix',
        '--no-error-on-unmatched-pattern',
        ...targets,
      ],
      root
    )
  } finally {
    rmSync(join(root, SORT_CONFIG), { force: true })
  }
}

export async function runFormat(root, files) {
  const { oxfmtBin } = await ensureTools()
  const targets = files.map((file) => repoPath(root, file) ?? file)
  run(oxfmtBin, ['--no-error-on-unmatched-pattern', ...targets], root)
}

// <generated-rule-map>
// Old suppression rule (`group/rule`) -> Oxlint rules that can report the
// same code, from the rule map (Appendix A). An empty list means that Oxlint
// has no equivalent rule. Generated: do not edit by hand.
export const RULE_MAP = {
  'a11y/noAccessKey': ['jsx-a11y/no-access-key'],
  'a11y/noAmbiguousAnchorText': ['jsx-a11y/anchor-ambiguous-text'],
  'a11y/noAriaHiddenOnFocusable': ['jsx-a11y/no-aria-hidden-on-focusable'],
  'a11y/noAriaUnsupportedElements': ['jsx-a11y/aria-unsupported-elements'],
  'a11y/noAutofocus': ['jsx-a11y/no-autofocus'],
  'a11y/noDistractingElements': ['jsx-a11y/no-distracting-elements'],
  'a11y/noHeaderScope': ['jsx-a11y/scope'],
  'a11y/noInteractiveElementToNoninteractiveRole': [
    'jsx-a11y/no-interactive-element-to-noninteractive-role',
  ],
  'a11y/noLabelWithoutControl': ['jsx-a11y/label-has-associated-control'],
  'a11y/noNoninteractiveElementToInteractiveRole': [
    'jsx-a11y/no-noninteractive-element-to-interactive-role',
  ],
  'a11y/noNoninteractiveTabindex': ['jsx-a11y/no-noninteractive-tabindex'],
  'a11y/noPositiveTabindex': ['jsx-a11y/tabindex-no-positive'],
  'a11y/noRedundantAlt': ['jsx-a11y/img-redundant-alt'],
  'a11y/noRedundantRoles': ['jsx-a11y/no-redundant-roles'],
  'a11y/noStaticElementInteractions': [
    'jsx-a11y/no-static-element-interactions',
  ],
  'a11y/noSvgWithoutTitle': [],
  'a11y/useAltText': ['jsx-a11y/alt-text'],
  'a11y/useAnchorContent': ['jsx-a11y/anchor-has-content'],
  'a11y/useAriaActivedescendantWithTabindex': [
    'jsx-a11y/aria-activedescendant-has-tabindex',
  ],
  'a11y/useAriaPropsForRole': ['jsx-a11y/role-has-required-aria-props'],
  'a11y/useAriaPropsSupportedByRole': ['jsx-a11y/role-supports-aria-props'],
  'a11y/useButtonType': ['react/button-has-type'],
  'a11y/useFocusableInteractive': ['jsx-a11y/interactive-supports-focus'],
  'a11y/useGenericFontNames': [],
  'a11y/useHeadingContent': ['jsx-a11y/heading-has-content'],
  'a11y/useHtmlLang': ['jsx-a11y/html-has-lang'],
  'a11y/useIframeTitle': ['jsx-a11y/iframe-has-title'],
  'a11y/useKeyWithClickEvents': ['jsx-a11y/click-events-have-key-events'],
  'a11y/useKeyWithMouseEvents': ['jsx-a11y/mouse-events-have-key-events'],
  'a11y/useMediaCaption': ['jsx-a11y/media-has-caption'],
  'a11y/useSemanticElements': ['jsx-a11y/prefer-tag-over-role'],
  'a11y/useValidAnchor': ['jsx-a11y/anchor-is-valid'],
  'a11y/useValidAriaProps': ['jsx-a11y/aria-props'],
  'a11y/useValidAriaRole': ['jsx-a11y/aria-role'],
  'a11y/useValidAriaValues': ['jsx-a11y/aria-proptypes'],
  'a11y/useValidAutocomplete': ['jsx-a11y/autocomplete-valid'],
  'a11y/useValidLang': ['jsx-a11y/lang'],
  'complexity/noAdjacentSpacesInRegex': ['no-regex-spaces'],
  'complexity/noArguments': ['prefer-rest-params'],
  'complexity/noBannedTypes': [
    'typescript/no-empty-object-type',
    'typescript/no-wrapper-object-types',
    'typescript/no-unsafe-function-type',
  ],
  'complexity/noCommaOperator': ['no-sequences'],
  'complexity/noEmptyTypeParameters': [],
  'complexity/noExtraBooleanCast': ['no-extra-boolean-cast'],
  'complexity/noFlatMapIdentity': ['unicorn/prefer-array-flat'],
  'complexity/noImportantStyles': [],
  'complexity/noStaticOnlyClass': [
    'typescript/no-extraneous-class',
    'unicorn/no-static-only-class',
  ],
  'complexity/noThisInStatic': [],
  'complexity/noUselessCatch': ['no-useless-catch'],
  'complexity/noUselessConstructor': ['no-useless-constructor'],
  'complexity/noUselessContinue': [],
  'complexity/noUselessEmptyExport': ['typescript/no-useless-empty-export'],
  'complexity/noUselessEscapeInRegex': ['no-useless-escape'],
  'complexity/noUselessFragments': ['react/jsx-no-useless-fragment'],
  'complexity/noUselessLabel': ['no-extra-label'],
  'complexity/noUselessLoneBlockStatements': ['no-lone-blocks'],
  'complexity/noUselessRename': ['no-useless-rename'],
  'complexity/noUselessStringRaw': [],
  'complexity/noUselessSwitchCase': ['unicorn/no-useless-switch-case'],
  'complexity/noUselessTernary': ['no-unneeded-ternary'],
  'complexity/noUselessThisAlias': ['typescript/no-this-alias'],
  'complexity/noUselessTypeConstraint': [
    'typescript/no-unnecessary-type-constraint',
  ],
  'complexity/noUselessUndefinedInitialization': [],
  'complexity/useArrowFunction': ['prefer-arrow-callback'],
  'complexity/useDateNow': ['unicorn/prefer-date-now'],
  'complexity/useFlatMap': ['unicorn/prefer-array-flat-map'],
  'complexity/useIndexOf': ['unicorn/prefer-array-index-of'],
  'complexity/useLiteralKeys': ['no-useless-computed-key'],
  'complexity/useMathMinMax': ['unicorn/prefer-math-min-max'],
  'complexity/useNumericLiterals': ['prefer-numeric-literals'],
  'complexity/useOptionalChain': [],
  'complexity/useRegexLiterals': ['prefer-regex-literals'],
  'complexity/useSimpleNumberKeys': [],
  'correctness/noChildrenProp': ['react/no-children-prop'],
  'correctness/noConstAssign': ['no-const-assign'],
  'correctness/noConstantCondition': ['no-constant-condition'],
  'correctness/noConstantMathMinMaxClamp': ['oxc/bad-min-max-func'],
  'correctness/noConstructorReturn': ['no-constructor-return'],
  'correctness/noDuplicateAttributes': [],
  'correctness/noEmptyCharacterClassInRegex': ['no-empty-character-class'],
  'correctness/noEmptyPattern': ['no-empty-pattern'],
  'correctness/noGlobalObjectCalls': ['no-obj-calls'],
  'correctness/noInnerDeclarations': ['no-inner-declarations'],
  'correctness/noInvalidBuiltinInstantiation': [
    'no-new-native-nonconstructor',
    'unicorn/new-for-builtins',
  ],
  'correctness/noInvalidConstructorSuper': ['constructor-super'],
  'correctness/noInvalidDirectionInLinearGradient': [],
  'correctness/noInvalidGridAreas': [],
  'correctness/noInvalidPositionAtImportRule': [],
  'correctness/noInvalidUseBeforeDeclaration': ['no-use-before-define'],
  'correctness/noMissingVarFunction': [],
  'correctness/noNestedComponentDefinitions': [
    'react/no-unstable-nested-components',
  ],
  'correctness/noNonoctalDecimalEscape': ['no-nonoctal-decimal-escape'],
  'correctness/noPrecisionLoss': ['no-loss-of-precision'],
  'correctness/noRenderReturnValue': ['react/no-render-return-value'],
  'correctness/noSelfAssign': ['no-self-assign'],
  'correctness/noSetterReturn': ['no-setter-return'],
  'correctness/noStringCaseMismatch': [],
  'correctness/noSwitchDeclarations': ['no-case-declarations'],
  'correctness/noUnknownFunction': [],
  'correctness/noUnknownMediaFeatureName': [],
  'correctness/noUnknownProperty': [],
  'correctness/noUnknownPseudoClass': [],
  'correctness/noUnknownPseudoElement': [],
  'correctness/noUnknownTypeSelector': [],
  'correctness/noUnknownUnit': [],
  'correctness/noUnmatchableAnbSelector': [],
  'correctness/noUnreachable': ['no-unreachable'],
  'correctness/noUnreachableSuper': ['no-this-before-super'],
  'correctness/noUnsafeFinally': ['no-unsafe-finally'],
  'correctness/noUnsafeOptionalChaining': ['no-unsafe-optional-chaining'],
  'correctness/noUnusedFunctionParameters': [],
  'correctness/noUnusedImports': ['no-unused-vars'],
  'correctness/noUnusedLabels': ['no-unused-labels'],
  'correctness/noUnusedPrivateClassMembers': [
    'no-unused-private-class-members',
  ],
  'correctness/noUnusedVariables': ['no-unused-vars'],
  'correctness/noVoidElementsWithChildren': [
    'react/void-dom-elements-no-children',
  ],
  'correctness/noVoidTypeReturn': [],
  'correctness/noVueDataObjectDeclaration': [
    'vue/no-deprecated-data-object-declaration',
  ],
  'correctness/noVueDuplicateKeys': ['vue/no-dupe-keys'],
  'correctness/noVueReservedKeys': ['vue/no-reserved-keys'],
  'correctness/noVueReservedProps': ['vue/no-reserved-props'],
  'correctness/noVueVIfWithVFor': [],
  'correctness/useExhaustiveDependencies': ['react/exhaustive-deps'],
  'correctness/useHookAtTopLevel': ['react/rules-of-hooks'],
  'correctness/useImportExtensions': ['import/extensions'],
  'correctness/useInlineScriptId': ['nextjs/inline-script-id'],
  'correctness/useIsNan': ['use-isnan'],
  'correctness/useJsxKeyInIterable': ['react/jsx-key'],
  'correctness/useParseIntRadix': ['radix'],
  'correctness/useValidForDirection': ['for-direction'],
  'correctness/useValidTypeof': ['valid-typeof'],
  'correctness/useVueVForKey': [],
  'correctness/useVueValidTemplateRoot': [],
  'correctness/useVueValidVBind': [],
  'correctness/useVueValidVCloak': [],
  'correctness/useVueValidVElse': [],
  'correctness/useVueValidVElseIf': [],
  'correctness/useVueValidVHtml': [],
  'correctness/useVueValidVIf': [],
  'correctness/useVueValidVOn': [],
  'correctness/useVueValidVOnce': [],
  'correctness/useVueValidVPre': [],
  'correctness/useVueValidVText': [],
  'correctness/useYield': ['require-yield'],
  'performance/noAccumulatingSpread': ['oxc/no-accumulating-spread'],
  'performance/noBarrelFile': ['oxc/no-barrel-file'],
  'performance/noDynamicNamespaceImportAccess': [],
  'performance/noImgElement': ['nextjs/no-img-element'],
  'performance/noReExportAll': [],
  'performance/noUnwantedPolyfillio': ['nextjs/no-unwanted-polyfillio'],
  'performance/useDomNodeTextContent': ['unicorn/prefer-dom-node-text-content'],
  'performance/useGoogleFontPreconnect': ['nextjs/google-font-preconnect'],
  'security/noBlankTarget': ['react/jsx-no-target-blank'],
  'security/noDangerouslySetInnerHtml': ['react/no-danger'],
  'security/noDangerouslySetInnerHtmlWithChildren': [
    'react/no-danger-with-children',
  ],
  'security/noGlobalEval': ['no-eval'],
  'security/noScriptUrl': ['react/jsx-no-script-url'],
  'style/noDescendingSpecificity': [],
  'style/noHeadElement': ['nextjs/no-head-element'],
  'style/noInferrableTypes': ['typescript/no-inferrable-types'],
  'style/noParameterAssign': ['no-param-reassign'],
  'style/noUnusedTemplateLiteral': [],
  'style/noUselessElse': ['no-else-return'],
  'style/useArrayLiterals': ['no-array-constructor'],
  'style/useAsConstAssertion': ['typescript/prefer-as-const'],
  'style/useBlockStatements': ['curly'],
  'style/useConst': ['prefer-const'],
  'style/useDefaultParameterLast': ['default-param-last'],
  'style/useEnumInitializers': ['typescript/prefer-enum-initializers'],
  'style/useExponentiationOperator': ['prefer-exponentiation-operator'],
  'style/useExportType': [],
  'style/useImportType': ['typescript/consistent-type-imports'],
  'style/useLiteralEnumMembers': ['typescript/prefer-literal-enum-member'],
  'style/useNodejsImportProtocol': ['unicorn/prefer-node-protocol'],
  'style/useNumberNamespace': ['unicorn/prefer-number-properties'],
  'style/useSelfClosingElements': ['react/self-closing-comp'],
  'style/useShorthandFunctionType': ['typescript/prefer-function-type'],
  'style/useSingleVarDeclarator': ['one-var'],
  'style/useTemplate': ['prefer-template'],
  'style/useVueConsistentVBindStyle': [],
  'style/useVueConsistentVOnStyle': [],
  'style/useVueHyphenatedAttributes': [],
  'style/useVueMultiWordComponentNames': [],
  'suspicious/noApproximativeNumericConstant': ['oxc/approx-constant'],
  'suspicious/noAssignInExpressions': ['no-cond-assign'],
  'suspicious/noAsyncPromiseExecutor': ['no-async-promise-executor'],
  'suspicious/noBiomeFirstException': [],
  'suspicious/noCatchAssign': ['no-ex-assign'],
  'suspicious/noClassAssign': ['no-class-assign'],
  'suspicious/noCommentText': ['react/jsx-no-comment-textnodes'],
  'suspicious/noCompareNegZero': ['no-compare-neg-zero'],
  'suspicious/noConfusingLabels': ['no-labels'],
  'suspicious/noConfusingVoidType': ['typescript/no-invalid-void-type'],
  'suspicious/noConsole': ['no-console'],
  'suspicious/noConstEnum': ['oxc/no-const-enum'],
  'suspicious/noControlCharactersInRegex': ['no-control-regex'],
  'suspicious/noDebugger': ['no-debugger'],
  'suspicious/noDeprecatedMediaType': [],
  'suspicious/noDocumentCookie': ['unicorn/no-document-cookie'],
  'suspicious/noDocumentImportInPage': ['nextjs/no-document-import-in-page'],
  'suspicious/noDoubleEquals': ['eqeqeq'],
  'suspicious/noDuplicateAtImportRules': [],
  'suspicious/noDuplicateCase': ['no-duplicate-case'],
  'suspicious/noDuplicateClassMembers': ['no-dupe-class-members'],
  'suspicious/noDuplicateCustomProperties': [],
  'suspicious/noDuplicateElseIf': ['no-dupe-else-if'],
  'suspicious/noDuplicateEnumValues': ['typescript/no-duplicate-enum-values'],
  'suspicious/noDuplicateFontNames': [],
  'suspicious/noDuplicateJsxProps': ['react/jsx-no-duplicate-props'],
  'suspicious/noDuplicateObjectKeys': ['no-dupe-keys'],
  'suspicious/noDuplicateParameters': [],
  'suspicious/noDuplicateProperties': [],
  'suspicious/noDuplicateSelectorsKeyframeBlock': [],
  'suspicious/noDuplicateTestHooks': ['vitest/no-duplicate-hooks'],
  'suspicious/noEmptyBlock': [],
  'suspicious/noEmptyInterface': ['typescript/no-empty-interface'],
  'suspicious/noExportsInTest': ['jest/no-export'],
  'suspicious/noExtraNonNullAssertion': [
    'typescript/no-extra-non-null-assertion',
  ],
  'suspicious/noFallthroughSwitchClause': ['no-fallthrough'],
  'suspicious/noFocusedTests': ['vitest/no-focused-tests'],
  'suspicious/noFunctionAssign': ['no-func-assign'],
  'suspicious/noGlobalAssign': ['no-global-assign'],
  'suspicious/noGlobalIsFinite': ['unicorn/prefer-number-properties'],
  'suspicious/noGlobalIsNan': ['unicorn/prefer-number-properties'],
  'suspicious/noHeadImportInDocument': ['nextjs/no-head-import-in-document'],
  'suspicious/noIdenticalTestTitle': ['vitest/no-identical-title'],
  'suspicious/noImplicitAnyLet': [],
  'suspicious/noImportAssign': ['no-import-assign'],
  'suspicious/noImportantInKeyframe': [],
  'suspicious/noIrregularWhitespace': ['no-irregular-whitespace'],
  'suspicious/noLabelVar': ['no-label-var'],
  'suspicious/noMisleadingCharacterClass': ['no-misleading-character-class'],
  'suspicious/noMisleadingInstantiator': ['typescript/no-misused-new'],
  'suspicious/noMisrefactoredShorthandAssign': ['oxc/misrefactored-assign-op'],
  'suspicious/noNonNullAssertedOptionalChain': [
    'typescript/no-non-null-asserted-optional-chain',
  ],
  'suspicious/noOctalEscape': [],
  'suspicious/noProto': ['no-proto'],
  'suspicious/noPrototypeBuiltins': [
    'no-prototype-builtins',
    'prefer-object-has-own',
  ],
  'suspicious/noQuickfixBiome': [],
  'suspicious/noRedeclare': ['no-redeclare'],
  'suspicious/noRedundantUseStrict': [],
  'suspicious/noSelfCompare': ['no-self-compare'],
  'suspicious/noShadowRestrictedNames': ['no-shadow-restricted-names'],
  'suspicious/noShorthandPropertyOverrides': [],
  'suspicious/noSparseArray': ['no-sparse-arrays'],
  'suspicious/noSuspiciousSemicolonInJsx': [],
  'suspicious/noTemplateCurlyInString': ['no-template-curly-in-string'],
  'suspicious/noThenProperty': ['unicorn/no-thenable'],
  'suspicious/noTsIgnore': ['typescript/ban-ts-comment'],
  'suspicious/noUnknownAtRules': [],
  'suspicious/noUnsafeDeclarationMerging': [
    'typescript/no-unsafe-declaration-merging',
  ],
  'suspicious/noUnsafeNegation': ['no-unsafe-negation'],
  'suspicious/noUselessEscapeInString': ['no-useless-escape'],
  'suspicious/noUselessRegexBackrefs': ['no-useless-backreference'],
  'suspicious/noVueArrowFuncInWatch': ['vue/no-arrow-functions-in-watch'],
  'suspicious/noWith': ['no-with'],
  'suspicious/useAdjacentOverloadSignatures': [
    'typescript/adjacent-overload-signatures',
  ],
  'suspicious/useBiomeIgnoreFolder': [],
  'suspicious/useDefaultSwitchClauseLast': ['default-case-last'],
  'suspicious/useGetterReturn': ['getter-return'],
  'suspicious/useGoogleFontDisplay': ['nextjs/google-font-display'],
  'suspicious/useIsArray': ['unicorn/no-instanceof-array'],
  'suspicious/useIterableCallbackReturn': ['array-callback-return'],
  'suspicious/useNamespaceKeyword': ['typescript/prefer-namespace-keyword'],
}
// </generated-rule-map>

const COMMENT = /^\s*\*?\s*biome-ignore(-all|-start|-end)?(?=[\s:]|$)(.*)$/s
const COMMENT_RULE = /^\s+lint\/(\w+)\/(\w+)\s*:\s*(.*?)\s*$/s
const UNUSED_DIRECTIVE = 'Unused oxlint-disable directive'

function lineIndex(source) {
  const starts = [0]
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '\n') {
      starts.push(i + 1)
    }
  }
  // 1-based line of a UTF-16 offset (oxc-parser uses UTF-16 offsets).
  const lineOf = (offset) => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if (starts[middle] <= offset) {
        low = middle
      } else {
        high = middle - 1
      }
    }
    return low + 1
  }
  return { starts, lineOf }
}

// Spans of the `{/* comment */}` containers in JSX, as `start:end`.
function jsxCommentContainers(program) {
  const spans = new Set()
  const visit = (node) => {
    if (
      node.type === 'JSXExpressionContainer' &&
      node.expression?.type === 'JSXEmptyExpression'
    ) {
      spans.add(`${node.start}:${node.end}`)
    }
    for (const value of Object.values(node)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item && typeof item === 'object' && typeof item.type === 'string') {
          visit(item)
        }
      }
    }
  }
  visit(program)
  return spans
}

export function findBiomeComments(
  filename,
  source,
  parseSync,
  parsed = parseSync(filename, source)
) {
  const { lineOf } = lineIndex(source)
  const found = []
  let containers
  for (const comment of parsed.comments) {
    const match = COMMENT.exec(comment.value)
    if (!match) {
      continue
    }
    let { start, end } = comment
    let style = comment.type === 'Line' ? 'line' : 'block'
    if (style === 'block') {
      const before = /\{\s*$/.exec(source.slice(0, start))
      const after = /^\s*\}/.exec(source.slice(end))
      if (
        before &&
        after &&
        (containers ??= jsxCommentContainers(parsed.program)).has(
          `${start - before[0].length}:${end + after[0].length}`
        )
      ) {
        start -= before[0].length
        end += after[0].length
        style = 'jsx'
      }
    }
    const range = match[1] === '-start' || match[1] === '-end'
    const rule = range ? null : COMMENT_RULE.exec(match[2])
    found.push({
      kind: rule ? (match[1] === '-all' ? 'all' : 'next') : 'unsupported',
      biomeRule: rule ? `${rule[1]}/${rule[2]}` : '',
      reason: rule ? rule[3] : '',
      start,
      end,
      line: lineOf(start),
      style,
    })
  }
  return found
}

function indexNodes(program) {
  // Outermost node for each start offset, with its parent and parent key.
  const byStart = new Map()
  const visit = (node, parent, key) => {
    if (typeof node.start === 'number' && typeof node.type === 'string') {
      const known = byStart.get(node.start)
      if (!known || node.end > known.node.end) {
        byStart.set(node.start, { node, parent, key })
      }
    }
    for (const [childKey, value] of Object.entries(node)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object') {
            visit(item, node, childKey)
          }
        }
      } else if (value && typeof value === 'object' && value.type) {
        visit(value, node, childKey)
      }
    }
  }
  visit(program, null, null)
  return byStart
}

const JSX_PARENTS = new Set(['JSXElement', 'JSXFragment'])
const JSX_KEYS = new Set(['children', 'closingElement', 'closingFragment'])

function isJsxChild(entry) {
  return Boolean(
    entry && JSX_PARENTS.has(entry.parent?.type) && JSX_KEYS.has(entry.key)
  )
}

function skipSpaceAndComments(source, offset, comments) {
  let position = offset
  for (;;) {
    while (position < source.length && /\s/.test(source[position])) {
      position += 1
    }
    const comment = comments.find((c) => c.start === position)
    if (!comment) {
      return position
    }
    position = comment.end
  }
}

const ruleBase = (rule) => rule.split('/').pop()
const matchesRule = (diagnostic, rule) =>
  typeof diagnostic.code === 'string' &&
  diagnostic.code.endsWith(`(${ruleBase(rule)})`)

function directive(rules, reasons, indent, jsx) {
  const unique = [...new Set(reasons.filter(Boolean))]
  const text = `oxlint-disable-next-line ${[...new Set(rules)].join(', ')}${
    unique.length ? ` -- ${unique.join('; ')}` : ''
  }`
  return jsx ? `${indent}{/* ${text} */}` : `${indent}// ${text}`
}

// Removes the old comments from one file and records what to put back.
function prepareFile(file, original, parseSync) {
  const parsed = parseSync(file, original)
  const comments = findBiomeComments(file, original, parseSync, parsed)
  const { starts, lineOf } = lineIndex(original)
  const nodes = indexNodes(parsed.program)
  const lines = original.split('\n')
  const blanked = new Set()
  // Inline comments removed from a line: { at, length } in stripped columns.
  const removed = new Map()
  const entries = []
  const unplaced = []
  for (const comment of comments) {
    const candidates = RULE_MAP[comment.biomeRule]
    if (comment.kind === 'unsupported') {
      unplaced.push({ file, line: comment.line, why: 'unsupported form' })
      continue
    }
    if (!candidates) {
      unplaced.push({
        file,
        line: comment.line,
        why: `no Oxlint mapping for ${comment.biomeRule}`,
      })
      continue
    }
    const firstLine = lineOf(comment.start)
    const lastLine = lineOf(comment.end - 1)
    const before = original.slice(starts[firstLine - 1], comment.start)
    const lineEnd =
      starts[lastLine] === undefined ? original.length : starts[lastLine] - 1
    const after = original.slice(comment.end, lineEnd)
    const wholeLine = !before.trim() && !after.trim()
    if (!wholeLine && firstLine !== lastLine) {
      unplaced.push({
        file,
        line: comment.line,
        why: 'multi-line inline comment',
      })
      continue
    }
    let span
    if (comment.kind === 'next') {
      const offset = skipSpaceAndComments(
        original,
        comment.end,
        parsed.comments
      )
      const entry = nodes.get(offset)
      if (!entry) {
        unplaced.push({
          file,
          line: comment.line,
          why: 'no code node after it',
        })
        continue
      }
      span = [entry.node.start, entry.node.end]
    }
    if (wholeLine) {
      for (let line = firstLine; line <= lastLine; line += 1) {
        lines[line - 1] = ''
        blanked.add(line)
      }
    } else {
      const text = lines[firstLine - 1]
      const earlier = removed.get(firstLine) ?? []
      const shift = earlier.reduce((sum, r) => sum + r.length, 0)
      const column = comment.start - starts[firstLine - 1] - shift
      const endColumn = comment.end - starts[firstLine - 1] - shift
      const kept = text.slice(0, column).trimEnd()
      lines[firstLine - 1] = kept + text.slice(endColumn)
      removed.set(firstLine, [
        ...earlier,
        { at: kept.length, length: endColumn - kept.length },
      ])
    }
    entries.push({ comment, candidates, span, firstLine, wholeLine })
  }
  return {
    file,
    original,
    stripped: lines.join('\n'),
    lines,
    blanked,
    removed,
    entries,
    unplaced,
    starts,
    nodes,
  }
}

// Finds the findings that each old comment protected, and the label lines
// where a directive can go. Oxlint matches a directive against the primary
// label of a finding, and its JSON output does not mark that label. Thus the
// last label comes first (the dependency array of `exhaustive-deps`), and
// Oxlint confirms each choice in `searchPlacements`.
// Oxlint label offsets count UTF-8 bytes in the stripped text. This returns
// the UTF-16 offset of a label in the original text (oxc-parser units).
function labelOffset(state) {
  const bytes = Buffer.from(state.stripped, 'utf8')
  const { starts } = lineIndex(state.stripped)
  return (label) => {
    const index = bytes.subarray(0, label.span.offset).toString('utf8').length
    const line = label.span.line
    const column = index - starts[line - 1]
    let original = column
    for (const r of state.removed.get(line) ?? []) {
      if (column >= r.at) {
        original += r.length
      }
    }
    return state.starts[line - 1] + original
  }
}

function planTargets(state, findings) {
  const offsetOf = labelOffset(state)
  const targets = []
  const fileWide = []
  const claimed = new Set()
  for (const entry of state.entries) {
    const { comment, candidates, span } = entry
    if (comment.kind === 'all') {
      const rules = candidates.filter((rule) =>
        findings.some((d) => matchesRule(d, rule))
      )
      findings.forEach((d, index) => {
        if (rules.some((rule) => matchesRule(d, rule))) {
          claimed.add(index)
        }
      })
      fileWide.push({ entry, rules })
      continue
    }
    findings.forEach((d, index) => {
      const rule = candidates.find((candidate) => matchesRule(d, candidate))
      if (!rule || claimed.has(index)) {
        return
      }
      // Only a finding inside the protected node counts, also on a shared line.
      const inRange = d.labels
        .filter((label) => {
          const offset = offsetOf(label)
          return offset >= span[0] && offset < span[1]
        })
        .map((label) => label.span.line)
      if (!inRange.length) {
        return
      }
      claimed.add(index)
      const last = inRange[inRange.length - 1]
      targets.push({
        index,
        entry,
        rule,
        lines: [...new Set([last, ...inRange])],
        choice: 0,
      })
    })
  }
  return { targets, fileWide, claimed }
}

// Text of one file with the chosen directives. `map[i]` is the stripped line
// number of output line i + 1, or 0 for an inserted line.
function buildText(state, targets, fileWide, keepBlank) {
  const insertBefore = new Map()
  for (const target of targets) {
    if (target.choice >= target.lines.length) {
      continue
    }
    const line = target.lines[target.choice]
    const list = insertBefore.get(line) ?? []
    list.push(target)
    insertBefore.set(line, list)
  }
  const replaceLine = new Map()
  for (const { entry, rules } of fileWide) {
    if (!rules.length) {
      continue
    }
    const text = `/* oxlint-disable ${rules.join(', ')}${
      entry.comment.reason ? ` -- ${entry.comment.reason}` : ''
    } */`
    if (entry.wholeLine) {
      replaceLine.set(entry.firstLine, text)
    } else {
      insertBefore.set(entry.firstLine, [
        ...(insertBefore.get(entry.firstLine) ?? []),
        { raw: text },
      ])
    }
  }
  const output = []
  const map = []
  state.lines.forEach((text, index) => {
    const line = index + 1
    const inserts = insertBefore.get(line) ?? []
    for (const item of inserts.filter((insert) => insert.raw)) {
      output.push(item.raw)
      map.push(0)
    }
    const rules = inserts.filter((insert) => insert.rule)
    if (rules.length) {
      const indent = /^\s*/.exec(text)[0]
      const node = state.nodes.get(state.starts[index] + indent.length)
      output.push(
        directive(
          rules.map((target) => target.rule),
          rules.map((target) => target.entry.comment.reason),
          indent,
          isJsxChild(node)
        )
      )
      map.push(0)
    }
    if (replaceLine.has(line)) {
      output.push(replaceLine.get(line))
      map.push(0)
    } else if (keepBlank || !state.blanked.has(line)) {
      output.push(text)
      map.push(line)
    }
  })
  return { text: output.join('\n'), map }
}

const findingKey = (d, mapLine) =>
  `${d.code ?? ''}|${d.message}|${d.labels
    .map((label) => mapLine(label.span.line))
    .join(',')}`

function countKeys(diagnostics, mapLine) {
  const counts = new Map()
  for (const d of diagnostics) {
    const key = findingKey(d, mapLine)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

const codeBase = (code) => /\(([^)]+)\)$/.exec(code ?? '')?.[1]

// Findings that the check compares: the rules of the converted comments and
// unused directives. A react-hooks directive also stops the React Compiler
// rules (for example `react/refs`) for the whole component, so the counts of
// other rules can change. `otherChanged` reports those changes.
function checkScope(plan) {
  const bases = new Set(
    plan.state.entries.flatMap((entry) => entry.candidates.map(ruleBase))
  )
  return (d) => typeof d.code !== 'string' || bases.has(codeBase(d.code))
}

function countCodes(diagnostics) {
  const counts = new Map()
  for (const d of diagnostics) {
    counts.set(d.code, (counts.get(d.code) ?? 0) + 1)
  }
  return counts
}

const sameCounts = (a, b) =>
  a.size === b.size && [...a].every(([key, count]) => b.get(key) === count)

// Moves each directive along its candidate lines until Oxlint stops
// reporting the finding. Sets `plan.ok` to false for a file where a finding
// stays, or where the directives change another finding of the same rules.
function searchPlacements(oxlintBin, root, plans) {
  const rounds = Math.max(
    1,
    ...plans.flatMap((plan) => plan.targets.map((t) => t.lines.length))
  )
  for (let round = 0; round < rounds; round += 1) {
    plans.forEach((plan) => {
      plan.built = buildText(plan.state, plan.targets, plan.fileWide, true)
      writeFileSync(join(root, plan.state.file), plan.built.text)
    })
    const lint = lintFiles(
      oxlintBin,
      root,
      plans.map((plan) => plan.state.file)
    )
    let moved = false
    for (const plan of plans) {
      const { map } = plan.built
      plan.lint = lint.get(plan.state.file)
      plan.mapLine = (line) => map[line - 1] ?? 0
      const now = countKeys(plan.lint, plan.mapLine)
      for (const target of plan.targets) {
        if (target.choice >= target.lines.length) {
          continue
        }
        const key = findingKey(plan.findings[target.index], (line) => line)
        if (now.has(key)) {
          target.choice += 1
          moved = true
        }
      }
    }
    if (!moved) {
      break
    }
  }
  for (const plan of plans) {
    const inScope = checkScope(plan)
    const expected = countKeys(
      plan.before.filter((d, index) => !plan.claimed.has(index) && inScope(d)),
      (line) => line
    )
    const now = countKeys(plan.lint.filter(inScope), plan.mapLine)
    plan.ok =
      sameCounts(expected, now) &&
      plan.targets.every((t) => t.choice < t.lines.length)
  }
}

function lintFiles(oxlintBin, root, files) {
  const result = spawnSync(
    oxlintBin,
    ['--format', 'json', '--no-error-on-unmatched-pattern', ...files],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    }
  )
  if (result.error) {
    throw result.error
  }
  let output
  try {
    output = JSON.parse(result.stdout)
  } catch {
    throw new Error(
      `${oxlintBin} exited with ${result.status}:\n${result.stdout}${result.stderr}`
    )
  }
  const byFile = new Map(files.map((file) => [file, []]))
  for (const diagnostic of output.diagnostics) {
    const file = relative(root, resolve(root, diagnostic.filename))
    byFile.get(file)?.push(diagnostic)
  }
  return byFile
}

const countUnused = (diagnostics) =>
  diagnostics.filter((d) => d.message.startsWith(UNUSED_DIRECTIVE)).length

export async function runConvert(root, files) {
  const { oxlintBin, oxfmtBin, parseSync } = await ensureTools()
  const summary = {
    comments: 0,
    placed: 0,
    deleted: 0,
    unplaced: [],
    deletedComments: [],
    otherChanged: [],
  }
  const states = []
  for (const file of listTargetFiles(root, files)) {
    const original = readFileSync(join(root, file), 'utf8')
    if (!original.includes('biome-ignore')) {
      continue
    }
    const state = prepareFile(file, original, parseSync)
    summary.comments += state.entries.length + state.unplaced.length
    summary.unplaced.push(...state.unplaced)
    if (state.entries.length) {
      states.push(state)
    }
  }
  if (!states.length) {
    return summary
  }
  const restore = (list) =>
    list.forEach((state) =>
      writeFileSync(join(root, state.file), state.original)
    )
  try {
    states.forEach((state) =>
      writeFileSync(join(root, state.file), state.stripped)
    )
    const names = states.map((state) => state.file)
    const before = lintFiles(oxlintBin, root, names)
    const plans = states.map((state) => {
      const diagnostics = before.get(state.file)
      const findings = diagnostics.map((d) =>
        typeof d.code === 'string' ? d : { code: '', message: '', labels: [] }
      )
      return {
        state,
        before: diagnostics,
        findings,
        ...planTargets(state, findings),
      }
    })
    searchPlacements(oxlintBin, root, plans)
    const kept = []
    for (const plan of plans) {
      const { state } = plan
      if (!plan.ok) {
        restore([state])
        for (const { comment } of state.entries) {
          summary.unplaced.push({
            file: state.file,
            line: comment.line,
            why: 'Oxlint still reports a protected finding, or another finding changed',
          })
        }
        continue
      }
      const final = buildText(state, plan.targets, plan.fileWide, false)
      writeFileSync(join(root, state.file), final.text)
      kept.push(plan)
    }
    if (kept.length) {
      run(
        oxfmtBin,
        [
          '--no-error-on-unmatched-pattern',
          ...kept.map((plan) => plan.state.file),
        ],
        root
      )
      const after = lintFiles(
        oxlintBin,
        root,
        kept.map((plan) => plan.state.file)
      )
      for (const plan of kept) {
        const final = after.get(plan.state.file)
        const inScope = checkScope(plan)
        const expected = plan.before.filter(
          (d, index) => !plan.claimed.has(index)
        )
        const same = sameCounts(
          countCodes(expected.filter(inScope)),
          countCodes(final.filter(inScope))
        )
        if (!same || countUnused(final) !== countUnused(expected)) {
          restore([plan.state])
          for (const { comment } of plan.state.entries) {
            summary.unplaced.push({
              file: plan.state.file,
              line: comment.line,
              why: 'the check after Oxfmt failed',
            })
          }
          continue
        }
        const want = countCodes(expected.filter((d) => !inScope(d)))
        const got = countCodes(final.filter((d) => !inScope(d)))
        for (const code of new Set([...want.keys(), ...got.keys()])) {
          if ((want.get(code) ?? 0) !== (got.get(code) ?? 0)) {
            summary.otherChanged.push({
              file: plan.state.file,
              code,
              before: want.get(code) ?? 0,
              after: got.get(code) ?? 0,
            })
          }
        }
        for (const entry of plan.state.entries) {
          const used =
            entry.comment.kind === 'all'
              ? plan.fileWide.some((w) => w.entry === entry && w.rules.length)
              : plan.targets.some((t) => t.entry === entry)
          if (used) {
            summary.placed += 1
          } else {
            summary.deleted += 1
            summary.deletedComments.push({
              file: plan.state.file,
              line: entry.comment.line,
              biomeRule: entry.comment.biomeRule,
            })
          }
        }
      }
    }
  } catch (error) {
    restore(states)
    throw error
  }
  return summary
}

async function runConvertStep(root, files) {
  const summary = await runConvert(root, files)
  process.stdout.write(
    `convert: ${summary.comments} comments, ${summary.placed} placed, ${summary.deleted} deleted, ${summary.unplaced.length} not placed\n`
  )
  for (const item of summary.deletedComments) {
    process.stdout.write(
      `deleted: ${item.file}:${item.line} ${item.biomeRule} (Oxlint reports nothing there)\n`
    )
  }
  for (const item of summary.otherChanged) {
    process.stdout.write(
      `note: ${item.file} ${item.code} findings ${item.before} -> ${item.after}\n`
    )
  }
  for (const item of summary.unplaced) {
    process.stdout.write(`not placed: ${item.file}:${item.line} ${item.why}\n`)
  }
  return summary.unplaced.length === 0
}

async function runSteps(root, steps, files) {
  for (const step of steps) {
    if (step === 'sort') {
      await runSort(root, files)
      process.stdout.write('sort: ok\n')
    } else if (step === 'format') {
      await runFormat(root, files)
      process.stdout.write('format: ok\n')
    } else {
      const ok = await runConvertStep(root, files)
      if (!ok) {
        return 1
      }
    }
  }
  return 0
}

function parseArgs(argv) {
  const options = { steps: STEPS, as: undefined, files: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--step') {
      const step = argv[(i += 1)]
      if (!STEPS.includes(step)) {
        return undefined
      }
      options.steps = [step]
    } else if (arg === '--as') {
      const value = argv[(i += 1)]
      const path = value && normalize(value)
      if (
        !path ||
        isAbsolute(path) ||
        path === '..' ||
        path.startsWith('../')
      ) {
        return undefined
      }
      options.as = path
    } else if (arg.startsWith('--')) {
      return undefined
    } else {
      options.files.push(arg)
    }
  }
  if (options.as !== undefined && options.files.length !== 1) {
    return undefined
  }
  return options
}

export async function main(argv) {
  const options = parseArgs(argv)
  const root = process.cwd()
  if (!options) {
    process.stderr.write(
      'usage: node scripts/oxc-migrate-branch.mjs [--step sort|format|convert] [--as <path>] [file...]\n'
    )
    return 2
  }
  for (const name of ['.oxlintrc.json', '.oxfmtrc.json']) {
    if (!existsSync(join(root, name))) {
      process.stderr.write(`error: ${name} is missing in ${root}\n`)
      return 2
    }
  }
  if (
    options.as === undefined &&
    options.files.some((file) => repoPath(root, file) === undefined)
  ) {
    process.stderr.write(`error: each file must be inside ${root}\n`)
    return 2
  }
  try {
    if (options.as === undefined) {
      return await runSteps(root, options.steps, options.files)
    }
    const input = options.files[0]
    const work = mkdtempSync(join(tmpdir(), 'oxc-migrate-branch-as-'))
    try {
      copyFileSync(join(root, '.oxlintrc.json'), join(work, '.oxlintrc.json'))
      copyFileSync(join(root, '.oxfmtrc.json'), join(work, '.oxfmtrc.json'))
      mkdirSync(dirname(join(work, options.as)), { recursive: true })
      copyFileSync(input, join(work, options.as))
      // Exit code 1: a comment is not placed. Keep the other results, as in
      // a run on the repository.
      const code = await runSteps(work, options.steps, [options.as])
      copyFileSync(join(work, options.as), input)
      return code
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`)
    return 1
  }
}

if (
  process.argv[1] &&
  pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url
) {
  process.exitCode = await main(process.argv.slice(2))
}
