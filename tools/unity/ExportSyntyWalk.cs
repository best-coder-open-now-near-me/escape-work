// Retarget one Unity Humanoid walk clip onto the two Synty skeletons used by
// Escape Work. The surrounding Node tool creates a disposable Unity project
// containing only the licensed source files required for this bake.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;

namespace EscapeWork
{
    public static class ExportSyntyWalk
    {
        [Serializable] class BonePose
        {
            public string bone;
            public Vector3 position;
            public Quaternion rotation;
        }

        [Serializable] class RestBone
        {
            public string bone;
            public string parent;
            public Vector3 position;
            public Quaternion rotation;
        }

        [Serializable] class BakeFrame
        {
            public float time;
            public List<BonePose> bones = new List<BonePose>();
        }

        [Serializable] class RigBake
        {
            public string id;
            public bool success;
            public string error;
            public string sourceClip;
            public float duration;
            public int sampleRate;
            public List<RestBone> restPose = new List<RestBone>();
            public List<BakeFrame> frames = new List<BakeFrame>();
        }

        [Serializable] class BakeReport
        {
            public int schema = 1;
            public List<RigBake> rigs = new List<RigBake>();
        }

        static readonly (string id, string asset)[] Targets = {
            ("synty-shops", "Assets/Source/SyntyShops.fbx"),
            ("synty-generic", "Assets/Source/SyntyGeneric.fbx"),
        };

        static AnimationClip LoadClip()
        {
            AnimationClip[] clips = AssetDatabase
                .LoadAllAssetsAtPath("Assets/Source/Walk.fbx")
                .OfType<AnimationClip>().ToArray();
            string expected = Environment.GetEnvironmentVariable("ESCAPE_WORK_WALK_CLIP")
                ?? "HumanM@Walk01_Forward";
            return clips.FirstOrDefault(clip => clip.name == expected)
                ?? clips.FirstOrDefault(clip => !clip.name.StartsWith("__preview__"));
        }

        static List<Transform> RigBones(Animator animator)
        {
            Transform hips = animator.GetBoneTransform(HumanBodyBones.Hips);
            if (hips == null)
                throw new InvalidOperationException("Humanoid avatar has no Hips transform");
            SkinnedMeshRenderer[] renderers = animator
                .GetComponentsInChildren<SkinnedMeshRenderer>(true);
            HashSet<Transform> skinBones = new HashSet<Transform>(
                renderers.SelectMany(renderer => renderer.bones)
                    .Where(bone => bone != null)
            );
            if (skinBones.Count == 0)
                throw new InvalidOperationException("Humanoid model has no skinned bones");
            Transform rigRoot = renderers.Select(renderer => renderer.rootBone)
                .FirstOrDefault(root => root != null && (root == hips || hips.IsChildOf(root)))
                ?? hips;
            skinBones.Add(rigRoot);
            return rigRoot.GetComponentsInChildren<Transform>(true)
                .Where(skinBones.Contains).ToList();
        }

        static BonePose Capture(Transform root, Transform bone)
        {
            return new BonePose {
                bone = bone.name,
                position = root.InverseTransformPoint(bone.position),
                rotation = Quaternion.Inverse(root.rotation) * bone.rotation,
            };
        }

        static RigBake Bake(string id, string path, AnimationClip clip, int sampleRate)
        {
            RigBake result = new RigBake {
                id = id,
                sourceClip = clip.name,
                duration = clip.length,
                sampleRate = sampleRate,
            };
            GameObject model = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (model == null) throw new FileNotFoundException("Could not load target rig", path);
            GameObject instance = UnityEngine.Object.Instantiate(model);
            try
            {
                instance.SetActive(true);
                Animator animator = instance.GetComponentInChildren<Animator>();
                if (animator == null || animator.avatar == null || !animator.avatar.isHuman)
                    throw new InvalidOperationException(id + " has no valid Humanoid avatar");
                animator.applyRootMotion = false;
                animator.enabled = true;
                animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
                animator.runtimeAnimatorController = null;
                animator.Rebind();
                animator.Update(0f);

                List<Transform> bones = RigBones(animator);
                HashSet<Transform> selected = new HashSet<Transform>(bones);
                result.restPose = bones.Select(bone => {
                    BonePose pose = Capture(instance.transform, bone);
                    return new RestBone {
                        bone = bone.name,
                        parent = bone.parent != null && selected.Contains(bone.parent)
                            ? bone.parent.name : "",
                        position = pose.position,
                        rotation = pose.rotation,
                    };
                }).ToList();

                PlayableGraph graph = PlayableGraph.Create("EscapeWorkWalk-" + id);
                try
                {
                    graph.SetTimeUpdateMode(DirectorUpdateMode.Manual);
                    AnimationPlayableOutput output = AnimationPlayableOutput.Create(
                        graph, "Animation", animator
                    );
                    AnimationClipPlayable playable = AnimationClipPlayable.Create(graph, clip);
                    playable.SetApplyFootIK(false);
                    playable.SetSpeed(0);
                    output.SetSourcePlayable(playable);
                    graph.Play();
                    int frameCount = Mathf.RoundToInt(clip.length * sampleRate) + 1;
                    for (int frameIndex = 0; frameIndex < frameCount; frameIndex++)
                    {
                        float time = Mathf.Min(frameIndex / (float)sampleRate, clip.length);
                        playable.SetTime(time);
                        graph.Evaluate(0.001f);
                        BakeFrame frame = new BakeFrame { time = time };
                        frame.bones = bones.Select(bone => Capture(instance.transform, bone)).ToList();
                        result.frames.Add(frame);
                    }
                }
                finally
                {
                    if (graph.IsValid()) graph.Destroy();
                }
                result.success = true;
            }
            catch (Exception error)
            {
                result.success = false;
                result.error = error.ToString();
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(instance);
            }
            return result;
        }

        public static void Run()
        {
            string outputPath = Environment.GetEnvironmentVariable("ESCAPE_WORK_WALK_DUMP")
                ?? Path.Combine(Path.GetTempPath(), "escape-work-synty-walk.json");
            int sampleRate = 30;
            int.TryParse(Environment.GetEnvironmentVariable("ESCAPE_WORK_WALK_RATE"), out sampleRate);
            sampleRate = Mathf.Max(1, sampleRate);
            BakeReport report = new BakeReport();
            try
            {
                AnimationClip clip = LoadClip();
                if (clip == null) throw new FileNotFoundException("Could not load walk clip");
                if (!clip.humanMotion)
                    throw new InvalidDataException(clip.name + " is not Humanoid motion");
                foreach ((string id, string asset) in Targets)
                    report.rigs.Add(Bake(id, asset, clip, sampleRate));
            }
            catch (Exception error)
            {
                foreach ((string id, string _) in Targets)
                    if (!report.rigs.Any(rig => rig.id == id))
                        report.rigs.Add(new RigBake { id = id, error = error.ToString() });
            }
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath));
            File.WriteAllText(outputPath, JsonUtility.ToJson(report, true));
            bool success = report.rigs.Count == Targets.Length && report.rigs.All(rig => rig.success);
            Debug.Log("ESCAPE_WORK_SYNTY_WALK=" + outputPath);
            if (!success)
                foreach (RigBake rig in report.rigs.Where(rig => !rig.success))
                    Debug.LogError(rig.id + ": " + rig.error);
            EditorApplication.Exit(success ? 0 : 1);
        }
    }
}
