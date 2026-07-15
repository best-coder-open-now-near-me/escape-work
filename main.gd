extends Control

var turn := 1

@onready var status: Label = $VBoxContainer/Status
@onready var start_button: Button = $VBoxContainer/StartButton


func _ready() -> void:
	start_button.pressed.connect(_on_start_pressed)


func _on_start_pressed() -> void:
	status.text = "Game Started - Turn %d" % turn
