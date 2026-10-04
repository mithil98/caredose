from tests.conftest import register

EVERY_DAY = [1, 2, 3, 4, 5, 6, 7]


def test_patient_crud(client, auth):
    r = client.post(
        "/api/v1/patients",
        headers=auth,
        json={"full_name": "  Rahul  ", "date_of_birth": "1950-04-02", "contact_phone": "+91 98765 43210"},
    )
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["full_name"] == "Rahul"
    assert p["timezone"] == "Asia/Kolkata"
    assert p["today"]["scheduled"] == 0

    upd = client.put(
        f"/api/v1/patients/{p['id']}", headers=auth, json={"full_name": "Rahul K", "timezone": "Europe/London"}
    )
    assert upd.status_code == 200
    assert upd.json()["timezone"] == "Europe/London"

    assert len(client.get("/api/v1/patients", headers=auth).json()) == 1
    assert client.delete(f"/api/v1/patients/{p['id']}", headers=auth).status_code == 204
    assert client.get(f"/api/v1/patients/{p['id']}", headers=auth).status_code == 404


def test_patient_validation(client, auth):
    assert client.post("/api/v1/patients", headers=auth, json={"full_name": ""}).status_code == 422
    assert (
        client.post(
            "/api/v1/patients", headers=auth, json={"full_name": "A", "date_of_birth": "2999-01-01"}
        ).status_code
        == 422
    )
    assert (
        client.post("/api/v1/patients", headers=auth, json={"full_name": "A", "contact_phone": "<script>"}).status_code
        == 422
    )


def test_caretaker_cannot_access_other_caretakers_data(client, setup):
    other = register(client, "other@example.com", "Other")
    pid = setup["patient_id"]
    assert client.get("/api/v1/patients", headers=other).json() == []
    assert client.get(f"/api/v1/patients/{pid}", headers=other).status_code == 404
    assert client.put(f"/api/v1/patients/{pid}", headers=other, json={"full_name": "X"}).status_code == 404
    assert client.get(f"/api/v1/patients/{pid}/medicines", headers=other).status_code == 404
    assert (
        client.put(f"/api/v1/medicines/{setup['medicine']['id']}", headers=other, json=setup["medicine"]).status_code
        == 404
    )
    assert client.delete(f"/api/v1/schedules/{setup['schedule']['id']}", headers=other).status_code == 404
    assert client.get("/api/v1/devices/MED-001", headers=other).status_code == 404
    assert client.get("/api/v1/medicines", headers=other).json() == []
    assert client.get("/api/v1/doses", headers=other).json()["total"] == 0
    assert client.get(f"/api/v1/analytics/patients/{pid}/adherence", headers=other).status_code == 404
    # cannot attach a device to someone else's patient
    r = client.post("/api/v1/devices", headers=other, json={"device_uid": "MED-999", "patient_id": pid})
    assert r.status_code == 404


def test_admin_sees_all_and_can_reassign(client, setup, admin_auth):
    pid = setup["patient_id"]
    assert len(client.get("/api/v1/patients", headers=admin_auth).json()) == 1
    other = register(client, "other@example.com", "Other")
    other_id = client.get("/api/v1/auth/me", headers=other).json()["id"]
    r = client.put(f"/api/v1/patients/{pid}", headers=admin_auth, json={"full_name": "Rahul", "caretaker_id": other_id})
    assert r.json()["caretaker"]["id"] == other_id
    assert client.get(f"/api/v1/patients/{pid}", headers=other).status_code == 200
    # device followed the patient to the new caretaker
    assert client.get("/api/v1/devices/MED-001", headers=other).status_code == 200


def test_caretaker_cannot_use_admin_endpoints(client, auth):
    for path in ("/api/v1/admin/users", "/api/v1/admin/audit-logs", "/api/v1/admin/health", "/api/v1/admin/config"):
        assert client.get(path, headers=auth).status_code == 403


def test_caretaker_cannot_reassign_patient(client, setup):
    other = register(client, "other@example.com", "Other")
    other_id = client.get("/api/v1/auth/me", headers=other).json()["id"]
    r = client.put(
        f"/api/v1/patients/{setup['patient_id']}",
        headers=setup["auth"],
        json={"full_name": "R", "caretaker_id": other_id},
    )
    assert r.json()["caretaker"]["id"] != other_id


def test_medicine_crud(client, auth):
    pid = client.post("/api/v1/patients", headers=auth, json={"full_name": "Rahul"}).json()["id"]
    r = client.post(
        f"/api/v1/patients/{pid}/medicines",
        headers=auth,
        json={"name": "Paracetamol", "generic_name": "Acetaminophen", "dose_quantity": "1", "dose_unit": "tablet"},
    )
    assert r.status_code == 201, r.text
    med = r.json()
    assert med["patient_name"] == "Rahul"
    upd = client.put(
        f"/api/v1/medicines/{med['id']}", headers=auth, json={**med, "dose_quantity": 2, "is_active": False}
    )
    assert upd.status_code == 200
    assert float(upd.json()["dose_quantity"]) == 2
    assert upd.json()["is_active"] is False
    assert client.get("/api/v1/medicines", headers=auth).json()[0]["id"] == med["id"]
    assert client.delete(f"/api/v1/medicines/{med['id']}", headers=auth).status_code == 204
    assert client.get(f"/api/v1/patients/{pid}/medicines", headers=auth).json() == []


def test_medicine_validation(client, auth):
    pid = client.post("/api/v1/patients", headers=auth, json={"full_name": "Rahul"}).json()["id"]
    for bad in (
        {"name": "", "dose_quantity": 1, "dose_unit": "tablet"},
        {"name": "A", "dose_quantity": 0, "dose_unit": "tablet"},
        {"name": "A", "dose_quantity": 1, "dose_unit": "<b>"},
    ):
        assert client.post(f"/api/v1/patients/{pid}/medicines", headers=auth, json=bad).status_code == 422


def test_schedule_crud_and_validation(client, setup):
    auth, pid, med = setup["auth"], setup["patient_id"], setup["medicine"]
    s = setup["schedule"]
    assert s["time_of_day"] == "20:00:00"
    assert s["period"] == "night"
    assert s["dose_unit"] == "tablet"
    assert float(s["dose_quantity"]) == 1  # defaulted from the medicine

    r = client.put(
        f"/api/v1/schedules/{s['id']}",
        headers=auth,
        json={
            "medicine_id": med["id"],
            "time_of_day": "08:00",
            "period": "morning",
            "days_of_week": [1, 3, 5, 5],
            "dose_quantity": 2,
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["days_of_week"] == [1, 3, 5]
    assert len(client.get(f"/api/v1/patients/{pid}/schedules", headers=auth).json()) == 1

    bad = [
        {"medicine_id": med["id"], "time_of_day": "08:00", "period": "brunch", "days_of_week": EVERY_DAY},
        {"medicine_id": med["id"], "time_of_day": "08:00", "period": "morning", "days_of_week": []},
        {"medicine_id": med["id"], "time_of_day": "08:00", "period": "morning", "days_of_week": [8]},
        {"medicine_id": med["id"], "time_of_day": "25:00", "period": "morning", "days_of_week": EVERY_DAY},
        {
            "medicine_id": med["id"],
            "time_of_day": "08:00",
            "period": "morning",
            "days_of_week": EVERY_DAY,
            "start_date": "2026-10-10",
            "end_date": "2026-10-01",
        },
    ]
    for body in bad:
        assert client.post(f"/api/v1/patients/{pid}/schedules", headers=auth, json=body).status_code == 422, body

    assert client.delete(f"/api/v1/schedules/{s['id']}", headers=auth).status_code == 204
    assert client.get("/api/v1/schedules", headers=auth).json() == []


def test_schedule_rejects_medicine_from_another_patient(client, setup):
    auth = setup["auth"]
    other_pid = client.post("/api/v1/patients", headers=auth, json={"full_name": "Asha"}).json()["id"]
    r = client.post(
        f"/api/v1/patients/{other_pid}/schedules",
        headers=auth,
        json={
            "medicine_id": setup["medicine"]["id"],
            "time_of_day": "08:00",
            "period": "morning",
            "days_of_week": EVERY_DAY,
        },
    )
    assert r.status_code == 422


def test_audit_log_records_changes(client, setup, admin_auth):
    actions = [a["action"] for a in client.get("/api/v1/admin/audit-logs", headers=admin_auth).json()["items"]]
    for expected in ("patient.create", "medicine.create", "schedule.create", "device.register", "user.register"):
        assert expected in actions
