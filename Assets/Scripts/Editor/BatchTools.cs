// CITY BATTLE — BatchTools: headless entry points for compile/scene/test from CI/agents.
using UnityEditor;
using UnityEditor.Compilation;
using UnityEngine;

namespace CityBattle.EditorTools
{
    public static class BatchTools
    {
        /// <summary>
        /// Forces a script compile and exits non-zero if there were errors.
        /// Invoke: Unity -batchmode -quit -executeMethod CityBattle.EditorTools.BatchTools.CompileAndReport
        /// </summary>
        public static void CompileAndReport()
        {
            Debug.Log("[BatchTools] Requesting script compilation...");
            bool hadError = false;

            CompilationPipeline.assemblyCompilationFinished += (asm, messages) =>
            {
                foreach (var m in messages)
                {
                    if (m.type == CompilerMessageType.Error)
                    {
                        hadError = true;
                        Debug.LogError($"[CompileError] {m.file}({m.line},{m.column}): {m.message}");
                    }
                }
            };

            CompilationPipeline.RequestScriptCompilation();
            // In batchmode, force the editor to process the compile synchronously-ish.
            EditorApplication.update += () => { };

            // Give the pipeline a moment then evaluate.
            EditorApplication.delayCall += () =>
            {
                if (EditorUtility.scriptCompilationFailed)
                {
                    Debug.LogError("[BatchTools] SCRIPT COMPILATION FAILED.");
                    EditorApplication.Exit(2);
                }
                else
                {
                    Debug.Log("[BatchTools] Compilation OK.");
                    EditorApplication.Exit(hadError ? 2 : 0);
                }
            };
        }
    }
}
