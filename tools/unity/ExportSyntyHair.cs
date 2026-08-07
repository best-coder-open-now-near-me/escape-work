using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace EscapeWork
{
    [Serializable]
    public sealed class HairMeshDump
    {
        public string id;
        public Vector3[] positions;
        public Vector3[] normals;
        public Vector2[] uv;
        public int[] indices;
    }

    public static class ExportSyntyHair
    {
        public static void Run()
        {
            var output = Environment.GetEnvironmentVariable("ESCAPE_WORK_HAIR_DUMP");
            if (string.IsNullOrWhiteSpace(output))
                throw new InvalidOperationException("ESCAPE_WORK_HAIR_DUMP is required.");

            Directory.CreateDirectory(output);
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            foreach (var source in Directory.GetFiles("Assets/Source", "*.fbx"))
            {
                var assetPath = source.Replace('\\', '/');
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(assetPath);
                if (prefab == null) throw new InvalidOperationException($"Could not import {assetPath}.");
                var instance = PrefabUtility.InstantiatePrefab(prefab) as GameObject;
                if (instance == null) throw new InvalidOperationException($"Could not instantiate {assetPath}.");

                try
                {
                    var positions = new List<Vector3>();
                    var normals = new List<Vector3>();
                    var uv = new List<Vector2>();
                    var indices = new List<int>();
                    var toRoot = instance.transform.worldToLocalMatrix;
                    foreach (var filter in instance.GetComponentsInChildren<MeshFilter>(true))
                    {
                        var mesh = filter.sharedMesh;
                        if (mesh == null) continue;
                        var matrix = toRoot * filter.transform.localToWorldMatrix;
                        var normalMatrix = matrix.inverse.transpose;
                        var first = positions.Count;
                        var meshPositions = mesh.vertices;
                        var meshNormals = mesh.normals;
                        var meshUv = mesh.uv;
                        for (var index = 0; index < meshPositions.Length; index++)
                        {
                            positions.Add(matrix.MultiplyPoint3x4(meshPositions[index]));
                            normals.Add(index < meshNormals.Length
                                ? normalMatrix.MultiplyVector(meshNormals[index]).normalized
                                : Vector3.up);
                            uv.Add(index < meshUv.Length ? meshUv[index] : Vector2.zero);
                        }
                        for (var submesh = 0; submesh < mesh.subMeshCount; submesh++)
                            foreach (var index in mesh.GetTriangles(submesh)) indices.Add(first + index);
                    }

                    if (positions.Count == 0) throw new InvalidOperationException($"No mesh geometry in {assetPath}.");
                    var dump = new HairMeshDump
                    {
                        id = Path.GetFileNameWithoutExtension(source),
                        positions = positions.ToArray(),
                        normals = normals.ToArray(),
                        uv = uv.ToArray(),
                        indices = indices.ToArray(),
                    };
                    var target = Path.Combine(output, dump.id + ".json");
                    File.WriteAllText(target, JsonUtility.ToJson(dump));
                    Debug.Log($"[Escape Work] Exported {dump.id}: {positions.Count} vertices, {indices.Count / 3} triangles.");
                }
                finally
                {
                    UnityEngine.Object.DestroyImmediate(instance);
                }
            }
        }
    }
}
